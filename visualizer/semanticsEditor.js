/* eslint-env browser */

'use strict';

(function(root, initModule) {
  if (typeof exports === 'object') {
    module.exports = initModule;
  } else {
    initModule(root.ohm, root.ohmEditor, root.CodeMirror, root.CheckedEmitter, root.domUtil,
        root.es6);
  }
})(this, function(ohm, ohmEditor, CodeMirror, CheckedEmitter, domUtil, es6) {

  // Privates
  // --------

  var UnicodeChars = {
    PLUS_SIGN: '\u002B',
    HYPHEN_MINUS: '\u002D',
    LEFTWARDS_ARROW: '\u2190'
  };

  // Creates a single `resultBlock`, which contains,
  // `value`: the actual result container
  // `operation`: the semantic operation for the result
  function createResultBlock(opName, resultWrapper) {
    var block = domUtil.createElement('resultBlock');
    domUtil.toggleClasses(block, {
      error: resultWrapper.isError,
      forced: resultWrapper.forced,
      passThrough: resultWrapper.isPassThrough,
      optNextStep: !resultWrapper.forced && resultWrapper.isError &&
          resultWrapper.forCallingSemantic
    });
    if (resultWrapper.missingSemanticsAction) {
      return block;
    }

    var result = resultWrapper.result;
    var valueContainer = block.appendChild(domUtil.createElement('value'));
    valueContainer.innerHTML = resultWrapper.isError ? result : JSON.stringify(result);

    var opSignature = opName;
    if (resultWrapper.args) {
      var argValues = Object.keys(resultWrapper.args).map(function(key) {
          return resultWrapper.args[key];
        });
      opSignature += '(' + argValues.join(',') + ')';
    }
    var opNameContainer = block.appendChild(domUtil.createElement('operation'));
    opNameContainer.innerHTML = opSignature;

    return block;
  }

  // Creates semantics editor result container and fills it the with `resultBlock`,
  // each of which reprensents a semantic result on this node.
  function createAndLoadResultContainer(traceNode, selfWrapper) {
    var resultContainer = domUtil.createElement('.result');
    var results = ohmEditor.semantics.getResults(traceNode);
    if (!results) {
      return resultContainer;
    }
    var idx = 0;
    Object.keys(results).forEach(function(opName) {
      var resultList = results[opName];
      resultList.forEach(function(resultWrapper) {
        var resultBlock = resultContainer.appendChild(createResultBlock(opName, resultWrapper));
        // If the result block is not the first one that contains a result, then add a left border
        // to it to seperate it from its former block
        if (resultBlock.textContent) {
          resultBlock.classList.toggle('leftBorder', idx++ > 0);
        }
        if (!resultWrapper.forced && resultWrapper.isNextStep) {
          selfWrapper.classList.add('nextStep');
        }

        if (resultWrapper.forCallingSemantic) {
          selfWrapper._args = resultWrapper.args;
          selfWrapper.classList.toggle('passThrough', resultWrapper.isPassThrough);
          resultContainer._nextStep = resultWrapper.isNextStep && resultBlock;
        }
      });
    });

    if (resultContainer.textContent.length === 0) {
      resultContainer.style.padding = '0';
    }
    return resultContainer;
  }

  // Append a semantics editor after the `label`, a semantics editor contains a
  // resultContainer, and conditionally (i.e. user cmd + click to open an editor)
  // contains a header container, a argument tags container, and a editor body container.
  function appendSemanticsEditor(wrapper) {
    var selfWrapper = wrapper.querySelector('.self');
    var traceNode = wrapper._traceNode;

    var editorWrapper = selfWrapper.appendChild(domUtil.createElement('.semanticsEditor'));
    var resultContainer = editorWrapper.appendChild(createAndLoadResultContainer(traceNode,
        selfWrapper));

    if (selfWrapper.querySelector('.passThrough') ||
        resultContainer.children.length === 1 && resultContainer.querySelector('.error')) {
      editorWrapper.hidden = true;
    } else {
      editorWrapper.classList.add('resultOnly');
    }

    // If the node is collapsed, and its children is one of the next steps, then mark it as a
    // temperary next step
    if (selfWrapper.parentElement.classList.contains('collapsed')) {
      selfWrapper.classList.toggle('tmpNextStep', !!resultContainer.querySelector('.optNextStep'));
    }

    // If the node's semantic was edited before refresh, and it's still the next step after the
    // editing, then keep the semantics editor open.
    if (traceNode._lastEdited && resultContainer._nextStep) {
      toggleSemanticsEditor(wrapper);
      // Only shows the result, i.e. the error, for evaluating the current semantic operation at
      // the node.
      resultContainer.style.display = 'flex';
      Array.prototype.forEach.call(resultContainer.children, function(child) {
        if (child !== resultContainer._nextStep) {
          child.style.display = 'none';
        } else {
          child.classList.remove('leftBorder');
        }
      });
    }
  }
  ohmEditor.parseTree.addListener('create:traceElement', function(wrapper, traceNode) {
    var shouldHaveSemanticsEditor = ohmEditor.options.semantics &&
        ohmEditor.semantics.appendEditor &&
        !wrapper.classList.contains('hidden') &&
        !wrapper.classList.contains('failed');
    if (shouldHaveSemanticsEditor) {
      appendSemanticsEditor(wrapper);
    }
  });

  function getArgDisplayList(defaultArgExp) {
    var argDisplayList = [];

    if (defaultArgExp instanceof ohm.pexprs.Seq) {
      defaultArgExp.factors.forEach(function(factor) {
        argDisplayList = argDisplayList.concat(getArgDisplayList(factor));
      });
    } else if (!(defaultArgExp instanceof ohm.pexprs.Not)) {
      // We skip `Not` as it won't be a semantics action function argument.
      argDisplayList.push(defaultArgExp.toDisplayString());
    }
    return argDisplayList;
  }

  // Create the DOM node that contains action argument display name
  function createArgDisplayContainer(display) {
    var argDisplayContainer = domUtil.createElement('span.display', display);

    // Shows or hides the argument editor by clicking the argument.
    argDisplayContainer.addEventListener('click', function(e) {
      var realArgContainer = argDisplayContainer.parentElement.querySelector('real');
      var shouldBeVisible = realArgContainer.style.display === 'none';
      realArgContainer.style.display = shouldBeVisible ? 'inline-block' : 'none';
      if (shouldBeVisible) {
        realArgContainer.focus();
      }
      e.stopPropagation();
    });

    return argDisplayContainer;
  }

  // Create the DOM node that contains real action argument name
  function createRealArgContainer(display, real, defaultArg) {
    var realArgContainer = domUtil.createElement('real');

    // Make the argument editor element editable
    realArgContainer.setAttribute('contenteditable', true);
    realArgContainer.addEventListener('keydown', function(e) {
      if (e.keyCode === 13 || e.keyCode === 32) {
        // Disable the ENTER and space keys
        e.preventDefault();
      }
    });

    // Default argument name is hidden if it's not user defined
    var shouldHide = real === defaultArg;
    if (shouldHide) {
      realArgContainer.style.display = 'none';
    }

    // Don't show argument name is if it's the same as its display
    var content = real === display ? '' : real;
    realArgContainer.textContent = content;
    return realArgContainer;
  }

  // Creates semantics editor header and fills it the with `headerblock`, each of which
  // represents an action argument.
  // TODO: Maybe get back the `<ruleName> = <ruleBody>` format, so
  // we'll be able to show _iter/_terminal nodes
  function createAndLoadEditorHeader(traceNode) {
    var header = domUtil.createElement('.header');
    var actionArgPairedList = ohmEditor.semantics.getActionArgPairedList(traceNode);

    // Fill the header contiainter with `headerBlock`
    // Each `headerBlock` represent an argument, inside there are:
    // `span.display`, which contains the argument display name
    // `real`, which is the argument rename editor that contains the real arg name
    var argDefaultList = actionArgPairedList.argExpr.toArgumentNameList(1);
    var argRealList = actionArgPairedList.real;
    var argDisplayList = getArgDisplayList(actionArgPairedList.argExpr);
    argDisplayList.forEach(function(argDisplay, idx) {
      var argReal = argRealList ? argRealList[idx] : argDefaultList[idx];
      var argDefault = argDefaultList[idx];
      var block = header.appendChild(domUtil.createElement('headerBlock'));
      block.appendChild(createArgDisplayContainer(argDisplay));
      block.appendChild(createRealArgContainer(argDisplay, argReal, argDefault));
    });

    return header;
  }

  // Creates a single operation argument tag, which contains a argument name, and
  // corresponding value.
  function createAndLoadArgTag(argName, argValue) {
    var argTag = domUtil.createElement('.argTag');
    argTag.innerHTML = argName;

    var valueSpan = argTag.appendChild(domUtil.createElement('span'));
    valueSpan.innerHTML = JSON.stringify(argValue);

    // If the value is hidden, hover the tag to temporarily show the argument value
    argTag.onmouseover = function(event) {
      if (!valueSpan.classList.contains('show')) {
        argTag.style.marginRight = valueSpan.scrollWidth + 12 + 'px';
      }
    };

    // Move out the mouse the argument value will hide again if it's temporarily showed up
    argTag.onmouseout = function(event) {
      if (!valueSpan.classList.contains('show')) {
        argTag.style.marginRight = '0';
      }
    };

    // Click the argument name to hide or show the corresponding value
    argTag.onclick = function(event) {
      var showing = valueSpan.classList.contains('show');
      valueSpan.classList.toggle('show', !showing);
    };

    return argTag;
  }

  // Creates a operation argument tag container, and fills it with argument tags
  function createAndLoadArgTags(selfWrapper) {
    var argTagContainer = domUtil.createElement('.argTags');
    var args = selfWrapper._args || ohmEditor.semantics.opArguments;
    if (!args) {
      return argTagContainer;
    }

    Object.keys(args).forEach(function(argName) {
      argTagContainer.appendChild(createAndLoadArgTag(argName, args[argName]));
    });
    return argTagContainer;
  }

  function retrieveArgumentsFromHeader(editorWrapper) {
    var header = editorWrapper.querySelector('.header');
    return Array.prototype.map.call(header.children, function(headerBlock) {
      return headerBlock.lastChild.textContent || headerBlock.firstChild.textContent;
    });
  }

  // Create the action editor, and load it with user defined action * default
  // action won't show
  function createAndLoadActionEditor(traceNode) {
    var actionEditorDiv = domUtil.createElement('.body');
    var actionEditorCM = CodeMirror(actionEditorDiv);

    // Load action
    actionEditorCM.setValue(ohmEditor.semantics.getActionBody(traceNode));
    actionEditorCM.setCursor({line: actionEditorCM.lineCount()});

    actionEditorCM.setOption('extraKeys', {
      'Cmd-S': function(cm) {
        var actionArguments = retrieveArgumentsFromHeader(actionEditorDiv.parentElement);
        ohmEditor.semantics.emit('save:semanticAction', traceNode, actionArguments, cm.getValue());
        traceNode._lastEdited = true;
        ohmEditor.parseTree.refresh();
        delete traceNode._lastEdited;
      }
    });
    return actionEditorDiv;
  }

  // Insert semantics editor body to the editor wrapper, which includes:
  // `header`: the rule body that alows for renaming
  // `argTags`: the argument tags shows the arguments' names with values
  // `body`: the cm that for editing semantics action
  function insertEditorBody(selfWrapper) {
    // Mark the `selfWrapper` for the shadow styling
    selfWrapper.classList.add('selected');

    var editorWrapper = selfWrapper.querySelector('.semanticsEditor');
    var traceNode = selfWrapper.parentElement._traceNode;
    var resultContainer = editorWrapper.querySelector('.result');

    // Ceate and load editor header
    editorWrapper.insertBefore(createAndLoadEditorHeader(traceNode), resultContainer);

    // Ceate and load argument tags
    editorWrapper.insertBefore(createAndLoadArgTags(selfWrapper), resultContainer);

    // Create and load action editor
    var actionEditor = editorWrapper.insertBefore(createAndLoadActionEditor(traceNode),
        resultContainer);
    var actionEditorCM = actionEditor.firstChild.CodeMirror;
    actionEditorCM.focus();
    actionEditorCM.refresh();
  }

  // Remove `header`, `argTags`, and `body` from the editor wrapper
  function removeEditorBody(selfWrapper) {
    selfWrapper.classList.remove('selected');

    var editorWrapper = selfWrapper.querySelector('.semanticsEditor');
    var header = editorWrapper.querySelector('.header');
    var argTags = editorWrapper.querySelector('.argTags');
    var body = editorWrapper.querySelector('.body');
    editorWrapper.removeChild(header);
    editorWrapper.removeChild(argTags);
    editorWrapper.removeChild(body);
  }

  // Hides or shows the semantics editor of `el`, which is a div.pexpr.
  function toggleSemanticsEditor(wrapper) {
    var selfWrapper = wrapper.querySelector('.self');
    if (selfWrapper.parentElement !== wrapper) {
      return;
    }

    var editorWrapper = selfWrapper.querySelector('.semanticsEditor');
    // If there is no semantics editor (e.g., for a implicit space cst node), do nothing.
    if (!editorWrapper || editorWrapper.parentElement !== selfWrapper) {
      return;
    }

    var resultOnly = editorWrapper.classList.contains('resultOnly');
    var showing = resultOnly && !editorWrapper.classList.contains('showing');
    if (resultOnly) {
      editorWrapper.classList.toggle('showing', showing);
    } else {
      editorWrapper.hidden = !editorWrapper.hidden;
    }

    // Insert or remove the editor body. This avoids having too many CodeMirror.
    if (showing || !resultOnly && !editorWrapper.hidden) {
      // If we toggle to show the semantics editor of `el`, insert the editor body
      insertEditorBody(selfWrapper);
    } else {
      // If we toggle to hide the semantics editor of `el`, remove the editor body
      removeEditorBody(selfWrapper);
    }

  }
  ohmEditor.parseTree.addListener('cmdclick:traceElement', toggleSemanticsEditor);

  // Retrieve arguments from the menu entry's submenu
  function retrieveArgumentsFromSubList(entry) {
    var argumentWrappers = entry.querySelectorAll('ul li');
    if (!argumentWrappers) {
      return undefined;
    }

    var operationArguments = Object.create(null);
    Array.prototype.forEach.call(argumentWrappers, function(argumentWrapper) {
      var name = argumentWrapper.querySelector('.name').textContent;
      var valueContainer = argumentWrapper.querySelector('.value');
      var value = valueContainer.value;
      // If the value is not a valid es6 `assignmentExpression`, and we are not ignoring
      // invalid value, throw an error. This provides a clear and readable error message.
      var isExpression = es6.match(value, 'AssignmentExpression<withIn>').succeeded();
      valueContainer.classList.toggle('error', value && !isExpression);
      if (value && !isExpression) {
        throw new Error(value + ' is not a valid expression for argument assignment.');
      }
      var returnStmt = 'return ' + value + ';';
      operationArguments[name] = new Function(returnStmt)();    // eslint-disable-line no-new-func
    });
    return operationArguments;
  }

  // Create a menu entry that wraps the argument name and a textarea for user to enter
  // corresponding value.
  function createArgumentWrapper(name) {
    var wrapper = domUtil.createElement('li');
    wrapper.appendChild(domUtil.createElement('.name', name));
    wrapper.appendChild(domUtil.createElement('.assign', UnicodeChars.LEFTWARDS_ARROW));
    var valueContainer = wrapper.appendChild(domUtil.createElement('textarea.value'));
    valueContainer.placeholder = 'value';
    valueContainer.cols = 5;
    valueContainer.onkeyup = function(e) {
      valueContainer.cols = Math.max(valueContainer.value.length, 5);
    };
    valueContainer.onclick = function(e) {
      valueContainer.classList.remove('error');
      e.stopPropagation();
    };
    valueContainer.onkeypress = function(e) {
      valueContainer.classList.remove('error');
      if (e.keyCode === 13) {
        e.preventDefault();
      }
    };
    return wrapper;
  }

  // Create a submenu that wraps the list of arguments.
  function createArgumentsWrapper(formals) {
    var argumentsWrapper = domUtil.createElement('ul');
    formals.forEach(function(name) {
      argumentsWrapper.appendChild(createArgumentWrapper(name));
    });
    argumentsWrapper.hidden = true;
    return argumentsWrapper;
  }

  // Append a `resultBlock` to the result container of the editor
  function appendSingleResult(editorWrapper, entry, traceNode, name) {
    var args = retrieveArgumentsFromSubList(entry);
    var resultWrapper = !ohmEditor.semantics.getResult(traceNode, name, args) &&
          ohmEditor.semantics.forceResult(traceNode, name, args);
    // If the result already showed, return.
    if (!resultWrapper) {
      return;
    }

    var resultContainer = editorWrapper.querySelector('.result');
    var resultBlock = resultContainer.appendChild(createResultBlock(name, resultWrapper));
    var resultBlocks = resultContainer.querySelectorAll('resultBlock');
    var hasLeftBorder = false;
    Array.prototype.forEach.call(resultBlocks, function(block) {
      if (block.textContent && block !== resultBlock) {
        hasLeftBorder = true;
      } else if (block === resultBlock) {
        resultBlock.classList.toggle('leftBorder', hasLeftBorder);
      }
    });
    editorWrapper.hidden = false;
    editorWrapper.classList.add('resultOnly');
  }

  // Create an menu entry that corresponding a semantic operation
  function createSemanticEntry(semanticOperation, traceNode, editorWrapper) {
    var name = semanticOperation.name;
    var entry = domUtil.createElement('li');
    var formals = semanticOperation.formals;
    entry.innerHTML = '<label></label>';
    entry.firstChild.textContent = name;
    entry.appendChild(createArgumentsWrapper(formals));

    var args = retrieveArgumentsFromSubList(entry);
    var resultWrapper = ohmEditor.semantics.getResult(traceNode, name, args);
    var missingSemanticsAction = ohmEditor.semantics.missingSemanticsAction(traceNode, name);
    if (resultWrapper || missingSemanticsAction) {
      entry.classList.toggle('disabled',
          missingSemanticsAction ||    // Missing the semantics action for the node.
          formals.length === 0);       // The semantic result for the node already showed.
    }

    entry.onclick = function(event) {
      event.stopPropagation();
      if (entry.classList.contains('disabled')) {
        return;
      }
      try {
        appendSingleResult(editorWrapper, entry, traceNode, name);
      } catch (error) {
        window.alert(error);    // eslint-disable-line no-alert
        return;
      }
      if (formals.length === 0) {
        entry.classList.add('disabled');
      }
      document.querySelector('#parseTreeMenu').hidden = true;
    };

    entry.onkeypress = function(event) {
      event.stopPropagation();
      if (event.keyCode !== 13) {
        return;
      }
      event.preventDefault();
      try {
        appendSingleResult(editorWrapper, entry, traceNode, name);
      } catch (error) {
        window.alert(error);    // eslint-disable-line no-alert
        return;
      }
      document.querySelector('#parseTreeMenu').hidden = true;
    };
    return entry;
  }

  // Add all the semantics to the submenu of `Force evaluation`
  function addSemanticEntries(entryWrapper, traceNode, editorWrapper) {
    var semanticOperations = ohmEditor.semantics.getSemantics();
    var operations = semanticOperations.operations;
    Object.keys(operations).forEach(function(operationName) {
      entryWrapper.appendChild(createSemanticEntry(operations[operationName], traceNode,
          editorWrapper));
    });

    var attributes = semanticOperations.attributes;
    Object.keys(attributes).forEach(function(attributeName) {
      entryWrapper.appendChild(createSemanticEntry(attributes[attributeName], traceNode,
          editorWrapper));
    });
  }
  ohmEditor.parseTree.addListener('contextMenu', function(target, traceNode, addMenuItem) {
    var selfWrapper = domUtil.closestElementMatching('.self', target);
    var editorWrapper = selfWrapper.querySelector('.semanticsEditor');
    var evaluatingSemantics = ohmEditor.semantics.appendEditor;
    var forceEntryContent = 'Force Evaluation';
    forceEntryContent += '<span>' + (evaluatingSemantics ? UnicodeChars.PLUS_SIGN : '') +
        '</span>';
    var forceEntry = addMenuItem('forceEvaluation', forceEntryContent, evaluatingSemantics,
        function(event) { event.stopPropagation(); });
    forceEntry.querySelector('span').className = 'sign';
    if (!evaluatingSemantics) {
      return;
    }
    // Hover the `Force Evaluation` entry to show forcing options
    forceEntry.onmouseover = function() {
      forceEntry.querySelector('label span').innerHTML = UnicodeChars.HYPHEN_MINUS;
      var entryWrapper;
      if (forceEntry.querySelector('ul')) {
        entryWrapper = forceEntry.querySelector('ul');
      } else {
        entryWrapper = forceEntry.appendChild(domUtil.createElement('ul'));
        entryWrapper.hidden = true;
        addSemanticEntries(entryWrapper, traceNode, editorWrapper);
      }
    };
    forceEntry.onmouseout = function() {
      forceEntry.querySelector('label span').innerHTML = UnicodeChars.PLUS_SIGN;
    };
  });

  // Remove the node's `tmpNextStep` mark if there is any.
  ohmEditor.parseTree.addListener('expand:traceElement', function(wrapper) {
    var selfWrapper = wrapper.querySelector('.self');
    selfWrapper.classList.remove('tmpNextStep');
  });

  // If one of the node's descendants is `next step`, mark it as temporary `next step`.
  ohmEditor.parseTree.addListener('collapse:traceElement', function(wrapper) {
    var selfWrapper = wrapper.querySelector('.self');
    var resultContainer = selfWrapper.querySelector('.semanticsEditor .result');
    if (!resultContainer) {
      return;
    }
    var shouldMark = resultContainer.querySelector('.optNextStep');
    selfWrapper.classList.toggle('tmpNextStep', !!shouldMark);
  });

  // Exports
  // -------
  ohmEditor.semantics = new CheckedEmitter();
  ohmEditor.semantics.registerEvents({
    // Emitted after adding an new operation/attribute
    'add:semanticOperation': ['type', 'name', 'optArguments', 'optOrigActionDict'],

    // Emitted after changing to another semantic operation
    'change:semanticOperation': ['targetName', 'optArguments'],

    // Emitted after editing the semantics operation button
    'edit:semanticOperation': ['wrapper', 'operationName', 'opDescription'],

    // Emitted after pressing cmd-S in semantics editor
    'save:semanticAction': ['traceNode', 'actionArguments', 'actionBody']
  });
});
