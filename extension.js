// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
// this method is called when vs code is activated

function activate(context) {
    // Create a decorator types that we use to decorate indent levels
    let timeout = null;
    let enabled = true;
    let currentLanguageId = null;
    let currentLanguageEnabled = false;
    let activeEditor = vscode.window.activeTextEditor;

    let currentIndentDecorationType;
    const alignmentDecorationType = vscode.window.createTextEditorDecorationType({
        before: {
            contentText: "⇥",
            color: "#7F7F7F7F",
            fontWeight: 'bold',
            // Move one character width left (but use width of 1ch to keep everything aligned)
            margin: "0 0 0 -1ch",
            width: "1ch",
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });


    let diffEditorSetting = {
        enabled: true,
        inline: false,
        sideBySideToggleFix: true
    }

    stretchySpacesDiffEditorConfigurationUpdated();
    if (activeEditor && checkLanguage()) {
        triggerUpdateDecorations();
    }

    vscode.window.onDidChangeTextEditorOptions(function(event) {
        const options = event.options;
        const indentChange = options && (options.insertSpaces !== undefined || options.tabSize !== undefined);
        if (indentChange && checkLanguage()) {
            clearDecorations();
            triggerUpdateDecorations();
        }
    }, null, context.subscriptions);

    vscode.window.onDidChangeActiveTextEditor(function(editor) {
        activeEditor = editor;
        if (editor && checkLanguage()) {
            clearDecorations();
            triggerUpdateDecorations();
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(function(event) {
        if (activeEditor && event.document === activeEditor.document && checkLanguage()) {
            triggerUpdateDecorations();
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeConfiguration(function(event) {
        if (event.affectsConfiguration('diffEditor') && isDiffEditor() && enabled && activeEditor) {
            diffEditorModeChanged();
        } else if (event.affectsConfiguration('stretchySpaces.diffEditor')) {
            stretchySpacesDiffEditorConfigurationUpdated();
            triggerUpdateDecorations();
        }
    }, null, context.subscriptions);

    vscode.commands.registerCommand('stretchySpaces.disable', () => {
        if (enabled) {
            enabled = false;
            clearDecorations();
        }
    });

    vscode.commands.registerCommand('stretchySpaces.enable', () => {
        if (!enabled) {
            enabled = true;
            if (activeEditor && checkLanguage()) {
                triggerUpdateDecorations();
            }
        }
    });

    function diffEditorModeChanged() {
        if (!diffEditorSetting.enabled) {
            return;
        }
        if (isInlineDiffEditor() && diffEditorSetting.inline == false) {
            clearDecorations();
            if (diffEditorSetting.sideBySideToggleFix) {
                // When switching from side-by-side to inline, clear decorations does not always work
                // Hack-y workaround - create a new file and immediately close it forces the editor to refresh
                vscode.commands.executeCommand("workbench.action.files.newUntitledFile")
                    .then(vscode.commands.executeCommand("workbench.action.closeActiveEditor"))
            }
        } else {
            triggerUpdateDecorations();
        }
    }

    function stretchySpacesDiffEditorConfigurationUpdated() {
        switch(vscode.workspace.getConfiguration('stretchySpaces').diffEditor) {
            case "Always":
                diffEditorSetting.enabled = true;
                diffEditorSetting.inline = true;
                diffEditorSetting.sideBySideToggleFix = false;
                break;
            case "Side-by-Side-Only":
                diffEditorSetting.enabled = true;
                diffEditorSetting.inline = false;
                diffEditorSetting.sideBySideToggleFix = false;
                break;
            case "Side-by-Side-Only-With-Toggle-Fix":
                diffEditorSetting.enabled = true;
                diffEditorSetting.inline = false;
                diffEditorSetting.sideBySideToggleFix = true;
                break;
            case "Never":
            default:
                diffEditorSetting.enabled = false;
                diffEditorSetting.inline = false;
                diffEditorSetting.sideBySideToggleFix = false;
                break;
        }
    }

    function isInlineDiffEditor() {
        return isDiffEditor()
            && vscode.workspace.getConfiguration('diffEditor').get('renderSideBySide') === false;
    }

    function isDiffEditor() {
        // https://github.com/microsoft/vscode/issues/15513#issuecomment-1245403215
        // return vscode.window.tabGroups?.activeTabGroup?.activeTab?.input instanceof vscode.TabInputTextDiff
        return vscode.window.tabGroups?.activeTabGroup?.activeTab?.input?.modified
            && activeEditor?.viewColumn === undefined;
    }

    function checkLanguage() {
        if (activeEditor) {
            if (currentLanguageId !== activeEditor.document.languageId) {
                currentLanguageEnabled = true
                const inclang = vscode.workspace.getConfiguration('stretchySpaces').includedLanguages || [];
                const exclang = vscode.workspace.getConfiguration('stretchySpaces').excludedLanguages || [];
                currentLanguageId = activeEditor.document.languageId;
                if (inclang.length !== 0) {
                    if (inclang.indexOf(currentLanguageId) === -1) {
                        currentLanguageEnabled = false;
                    }
                }
                if (exclang.length !== 0) {
                    if (exclang.indexOf(currentLanguageId) !== -1) {
                        currentLanguageEnabled = false;
                    }
                }
            }
        }
        return currentLanguageEnabled;
    }

    function clearDecorations() {
        if (activeEditor && currentIndentDecorationType) {
            activeEditor.setDecorations(currentIndentDecorationType, []);
            activeEditor.setDecorations(alignmentDecorationType, []);
            currentIndentDecorationType = null;
        }
    }

    function triggerUpdateDecorations() {
        if (!enabled) {
            return;
        }
        if (timeout) {
            clearTimeout(timeout);
        }
        const updateDelay = vscode.workspace.getConfiguration('stretchySpaces').updateDelay || 100;
        timeout = setTimeout(updateDecorations, updateDelay);
    }

    function updateDecorations() {
        if (!activeEditor || (!diffEditorSetting.enabled && isDiffEditor()) || (!diffEditorSetting.inline && isInlineDiffEditor()) || !enabled) {
            return;
        }
        const targetIndentation = vscode.workspace.getConfiguration('stretchySpaces').targetIndentation;
        if (!activeEditor.options.insertSpaces || targetIndentation === activeEditor.options.tabSize) {
            return;
        }
        const decorationRanges = [];
        const alignmentDecorationRanges = [];
        let regEx;
        if (vscode.workspace.getConfiguration('stretchySpaces').alignAsterisks) {
            // Spaces from the start of the line until before the space before a *,
            // to preserve JSDoc-style comments alignment
            regEx = /^( +)?(?!\*)(\S+)?/;
        } else {
            regEx = /^( +)?(\S+)?/;
        }
        const text = activeEditor.document.getText();

        if (!currentIndentDecorationType) {
            // 4 spaces rendered as 2, or 50% less: -0.5ch
            // 2 spaces rendered as 4, or 100% more: 1ch
            // current + percentChange × current = target
            const percentChange = (targetIndentation - activeEditor.options.tabSize) / activeEditor.options.tabSize;
            currentIndentDecorationType = vscode.window.createTextEditorDecorationType({
                letterSpacing: percentChange + 'ch', // https://css-tricks.com/the-lengths-of-css/#ch
                rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
            });
        }

        const alignmentDetectionSettings = vscode.workspace.getConfiguration('stretchySpaces').alignmentDetection;

        let currentIndentLength = 0;
        
        for (let lineIdx = 0; lineIdx < activeEditor.document.lineCount; lineIdx++) {
            const match = regEx.exec(activeEditor.document.lineAt(lineIdx).text);
            const matchText = match[1] || '';
            let indentationLength = matchText.length;
            let alignmentDetected = false;
            if (alignmentDetectionSettings.enabled) {
                if (indentationLength > currentIndentLength + (alignmentDetectionSettings.maxIndentationLevelIncrease * activeEditor.options.tabSize)) {
                    // If the indentation is more than that max increase allowed (from the previous indented line), 
                    // then alignment detected!  Use same indent length as before
                    indentationLength = currentIndentLength;
                    alignmentDetected = true;
                } else if (match[2]){
                    // If this is a line that has something other than all whitespace, then set the this indentation length as the current indent length
                    currentIndentLength = indentationLength;
                }
            }
            const startPos = new vscode.Position(lineIdx,0);
            const endPos = new vscode.Position(lineIdx, indentationLength);
            decorationRanges.push({ range: new vscode.Range(startPos, endPos), hoverMessage: null });
            if (alignmentDetected && alignmentDetectionSettings.displayIndicator) {
                alignmentDecorationRanges.push({ range: new vscode.Range(endPos, endPos), hoverMessage: null });
            }
        }
        activeEditor.setDecorations(currentIndentDecorationType, decorationRanges);
        activeEditor.setDecorations(alignmentDecorationType, alignmentDecorationRanges);

    }

}

exports.activate = activate;
