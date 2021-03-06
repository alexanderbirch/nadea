// NaDeA - License, source code and further information at http://logic-tools.github.io/
//
/// <reference path="jquery.d.ts"/>

// Update version number on page
var versionNumber = "0.1.5";
$(document).ready(() => $("title, #info span").html("NaDeA " + versionNumber));

// Set up index.nadea location
var indexNadeaURL = "http://nadea.compute.dtu.dk/index.nadea";
var readNadeaFileLocally = window.location.protocol !== "file:";

var INITIAL_PROOF = "OK{.}[]";

// Unknown interface stores information about
// the unknowns in an uncompleted proof
interface Unknown {
    x: any;
    inFm?: number;
    inAssumption?: number;
    inTm?: number;
    linkedTo?: Unknown[];
};

class State {
    p: Inductive;
    xs: Unknown[];
    gc: number;
};

var currentState: State;
var stateStack: IbStack;

var undefInductivesWithoutUnknowns: { parent: Inductive; self: Inductive; premiseIndex: number }[];

//var examples: { proof: string; name: string }[] = [];

$(document).ready(() => {
    /*
     * Initialize a generic proof structure
     * - is to be changed to the correct ind. syn type when goal is completed, and a rule is chosen
     */
    initNewProof();
    
    /* Jquery event handlers */
    attachEventHandlersUnknowns();
    attachMenuEvents();
    attachHashEventListeners();
    attachKeyBindings();

    // Load examples
    loadTestsAndHints();

    // Update
    update(window.location.hash ? true : false);
});


function initNewProof() {
    currentState = new State;
    currentState.p = new Inductive(null, []);;
    currentState.xs = [{ x: currentState.p, inFm: 1 }];
    currentState.gc = 0;

    stateStack = new IbStack(currentState);
}

function loadProof(x: Inductive[], reverse = false) {

    var states = [];
    x.forEach(ind => {
        var s = new State();
        s.gc = getNumGeneratedConstants(ind);
        s.p = ind;
        s.xs = reconstructUnknownsFromProof(ind);

        if (reverse)
            states.unshift(s);
        else
            states.push(s);
    });

    // Set x as reference proof
    currentState = states[0];

    var s = states.pop();
    stateStack.reset(s);

    while (states.length > 0) {
        s = states.pop();
        stateStack.update(IbStackEvent.UPDATE_INTERNAL, s);
    }

    // Update the view
    update();
};


function update(hidden: boolean = false) {
    // Find premises that have goals without unknowns
    undefInductivesWithoutUnknowns = [];

    findUndefInductivesWithoutUnknowns(undefInductivesWithoutUnknowns, currentState.p, null, 0, 0);

    undefInductivesWithoutUnknowns.some((v, i) => {
        if (v.parent instanceof synExiE) {
            if ((<synExiE> v.parent).waitingForPCompletion) {
                (<synExiE> v.parent).waitingForPCompletion = false;
                (<synExiE> v.parent).getNewsAndSub(getNewConstant());

                pushIndices(undefInductivesWithoutUnknowns, i + 1, 1);
                undefInductivesWithoutUnknowns[i + 1] = { parent: v.parent, self: v.self, premiseIndex: 1 };

                return true;
            }
        }

        return false;
    });

    // Check if "Boole" rule can be applied to found premises
    undefInductivesWithoutUnknowns.forEach(v => {
        if (v.self.premises.length === 0)
            if (v.self.trueByAssumption === undefined)
                v.self.checkGoal();
    });

    updateFrame(hidden);
}

function updateFrame(hidden: boolean) {
    // Clear the frame
    $("#frame #frameContainer").children().remove();

    if (hidden)
        $("#frame #frameContainer").hide();
    else 
        $("#frame #frameContainer").show();

    // Write proof lines
    appendLines(currentState.p, 0);

    // Replace unknowns with HTML elements
    replaceUnknowns();

    // Replace and format special codes
    replaceFormatSpecialCodes();

    // Replace Formal Symbols
    replaceFormalSymbols(".line .right");

    // Update indices on HTML elements to reflect keys in array of unknowns
    updateExistingIndexUnknowns();

    // Invoke resize listener on window element
    $(window).resize();
}


// Dict to proof codes stored
var proofCodes: { [id: string]: string };

function loadTestsAndHints() {
    // Initially the tests are the initial proof state
    proofCodes = {};

    for (var i = 0; i <= 9; i++)
        proofCodes["Test " + i] = "";

    proofCodes["Test suite"] = ". The test suite collects the final proof state for all tests but no tests are provided in the index.nadea file (or the file was not found)\n";

    /* Get .nadea file contents */

    var xhr = new XMLHttpRequest();

    if (readNadeaFileLocally) {
        // Try to fetch from server file system

        xhr.onreadystatechange = () => {
            if (xhr.readyState == 4 && xhr.status === 200) {
                readNadeaData(xhr.responseText);
            }
        }

        xhr.ontimeout = () => {
            readNadeaFileLocally = false;
            loadTestsAndHints();
        }

        xhr.open("GET", "index.nadea", true);
        xhr.timeout = 5000;
        xhr.setRequestHeader('Content-type', 'text/plain; charset=utf-8');
        xhr.send(null);
    }

    else {    
        // Load file from the net if not yet loaded
        xhr.onreadystatechange = () => {
            if (xhr.readyState == 4 && xhr.status === 200) {
                readNadeaData(decodeURI(xhr.responseText));
            }
        }

        xhr.ontimeout = () => {
            console.log("Failed to load tests and hints.");
        }

        xhr.open("GET", indexNadeaURL, true);
        xhr.timeout = 5000;
        xhr.setRequestHeader('Content-type', 'text/plain; charset=iso-8859-1');
        xhr.send(null);
    }
}

function readNadeaData(rawFileText: string) {
    // Go through each line of the loaded .nadea file

    var currentProofID: string = null;
    var currentProofCode: string = null;
    var testSuiteCodes: string[] = [];

    var endOfComments: boolean = null;

    var lines = rawFileText.split(/\n/).filter(x => { return x.trim() !== "" });

    var addProofCode = (id, code, bypassCheck = false) => {
        if (id !== null) {
            // End of proof code
            if (bypassCheck || isValidProofCode(currentProofCode))
                proofCodes[id] = code;
            else
                console.log("Invalid proof code (" + id + ") read from '.nadea' file.");
        }
    };

    lines.forEach((x, i) => {
        // Check if recognized as valid proof ID
        var idMatch = x.match(/^\#\s*((Test\s+([0-9]+|suite))|(Hint\s+[0-9]+))\s*$/);

        if (idMatch !== null) {
            addProofCode(currentProofID, currentProofCode);

            // Initialize new proof
            currentProofID = idMatch[1];
            currentProofCode = "";
            endOfComments = false;

        } else if (currentProofID !== null) {
            // Check if line is a comment
            var isComment: boolean = x.search(/^\./) !== -1;
            
            // If the comment block is exceeded, ignore additional comment lines
            // Used to filter away some empty comment lines after proof code
            if (!endOfComments && !isComment) {
                endOfComments = true;

                // Add this line to test suite if it is test [0-9]
                var idMatch2 = currentProofID.match(/Test ([0-9]+)/);

                if (idMatch2 !== null)
                    testSuiteCodes[+idMatch2[1]] = x;
            }

            if (endOfComments && isComment)
                return;

            // Append line to current proof code
            currentProofCode += x + "\n";
        }
    });

    addProofCode(currentProofID, currentProofCode);

    addProofCode("Test suite", ". The test suite collects the final proof state for all tests\n.\n" + testSuiteCodes.join("\n") + "\n");

    var allProofCodes = "";

    for (var key in proofCodes)
        allProofCodes += ".\n# " + key + "\n" + proofCodes[key];

    addProofCode("Online proofs", ". Online proofs in the index.nadea file\n" + allProofCodes, true);
    
    // Wait for nadea-file
    $(window).trigger("hashchange");
}

$(document).ready(() => {
    // Get width of window element
    var vw = $(window).width();

    // Turn values from Jquery CSS (in pixels) into vw units
    var frameFontSize = +(+$("#frame").css("font-size").replace("px", "")).toFixed(2) / vw * 100;
    var proofLineHeight = +(+$(".line > *").css("line-height").replace("px", "")).toFixed(2) / vw * 100;

    // Dummy element is added (and then removed) to get a computed pixel value for the indention
    var $indentProof = $("<div></div>").addClass("indentProof").hide().appendTo("body");
    var indentProofLeft = +(+$indentProof.css("padding-left").replace("px", "")).toFixed(2) / vw * 100;
    $indentProof.remove();

    $(window).resize(() => {
        // (Re-)align proof container with header
        $("#container").css({ marginTop: $("#headerContainer").height() + "px" });

        // Get an approximate value of the zoom level
        var scale = (vw / $(window).width());

        // Set relevant css in vw units
        $("#frame, .loadTextarea").css({ fontSize: (frameFontSize * scale).toFixed(2) + "vw" });
        $(".line > *").css({ lineHeight: (proofLineHeight * scale).toFixed(2) + "vw" });
        $(".indentProof").each((i, v) => {
            $(v).css({ paddingLeft: (indentProofLeft * scale * (+$(v).data("indent"))).toFixed(2) + "vw" });
        });
    });

    // Invoke resize function on each page load
    $(window).resize();
});

function attachEventHandlersUnknowns() {
    // Add click functions to unknowns in proof

    var indexUnknown: number;

    /*
     * New syn rule click handler
     */
    $(document).on("click", "a.newSynRule", e => {
        // Get clicked inductive
        var parentInductive = undefInductivesWithoutUnknowns[$(e.currentTarget).data("synUnknownIndex")];
        var x: Inductive;

        if (parentInductive.parent === null)
            x = currentState.p;
        else
            x = parentInductive.parent.premises[parentInductive.premiseIndex];

        newOverlay(e, "newSynRule",(x: Inductive) => {

            prepareCurrentStateUpdate();
            
            // Get parent inductive in order to replace generic "inductive" structure with correct structure for the selected rule
            if (parentInductive.parent === null)
                currentState.p = x;
            else
                parentInductive.parent.premises[parentInductive.premiseIndex] = x;

            // Special procedures for generating premises for Uni_E and Uni_I
            if (x instanceof synUniI)
                x.getPremises(getNewConstant());

            else if (x instanceof synUniE) {
                termHandlerUniE(e, x);
            }

            else
                x.getPremises(null, null);


            // Go through each line in order to compute the correct index  to insert the unknown premise at
            var insertIndex = 0;

            $(".line").each((i, line) => {
                insertIndex += $(line).find("a").not(".newSynRule").length;

                if ($(line).find("a.newSynRule").is(e.currentTarget)) {
                    return false;
                }
            });

            // Add generated unknowns
            addUnknownsPremises(x, insertIndex);

            // Update the view
            update();
        }, x);
    });

    /*
     * New formula
     */

    $(document).on("click", "a.newFormula", e => {
        // Get index of unknown that is to be replaced
        indexUnknown = $(e.currentTarget).data("indexUnknown");

        newOverlay(e, "newFormula",(fm: Formula) => {
            prepareCurrentStateUpdate();

            var replacedUnknowns = replaceUnknownsFormula(currentState.xs[indexUnknown], fm);

            // Remove previous unknowns from the pool of unknowns
            var linkedUnks: Unknown[][] = [[], []];

            replacedUnknowns.forEach(v => {
                currentState.xs.some((w, removeIndex) => {
                    if (v === w) {
                        var unk1: Unknown,
                            unk2: Unknown;

                        // Unknown is replaced with a one argument formula 
                        // Insert new unknown formula
                        if (fm instanceof FormulaOneArg) {
                            unk1 = { x: fm, inFm: 1 };

                            currentState.xs[removeIndex] = unk1;

                            linkedUnks[0].push(unk1);
                        }

                        // Unknown is replaced with a two argument formula
                        // Insert two new unknown formulas
                        else if (fm instanceof FormulaTwoArg || fm instanceof fmPre) {
                            pushIndices(currentState.xs, removeIndex + 1, 1);

                            unk1 = { x: fm, inFm: 1 };
                            unk2 = { x: fm, inFm: 2 };

                            currentState.xs[removeIndex] = unk1;
                            currentState.xs[removeIndex + 1] = unk2;

                            linkedUnks[0].push(unk1);
                            linkedUnks[1].push(unk2);
                        }

                        else if (fm instanceof fmFalsity) {
                            currentState.xs.splice(removeIndex, 1);
                        }

                        return true;
                    }
                });
            });

            // Set (eventual) links between unknowns
            setLinkedUnks(linkedUnks);

            // Update the view
            update();
        });
    });

    /*
     * New ID
     */

    $(document).on("click", "a.newID", e => {
        // Index of unknown to be replaced
        indexUnknown = $(e.currentTarget).data("indexUnknown");

        newOverlay(e, "newID",(id: string) => {

            prepareCurrentStateUpdate();

            var replacedUnknowns = replaceUnknownsID(currentState.xs[indexUnknown], id);

            replacedUnknowns.forEach(v => {
                currentState.xs.some((w, removeIndex) => {
                    if (v === w) {
                        currentState.xs.splice(removeIndex, 1);

                        return true;
                    }
                });
            });
            
            // Update the view
            update();
        });
    });

    /*
     * New Terms
     */

    function tmCallback(tms: number[]) {
        prepareCurrentStateUpdate();

        var replacedUnknowns = replaceUnknownsTm(currentState.xs[indexUnknown], tms);

        // Remove previous unknowns from the pool of unknowns
        var linkedUnks: Unknown[][] = [];

        replacedUnknowns.forEach(v => {
            currentState.xs.some((w, removeIndex) => {
                // Find array index of each replaced unknown
                if (v === w) {
                    if (currentState.xs[removeIndex].x instanceof fmPre
                        || currentState.xs[removeIndex].x instanceof tmFun) {

                        if (currentState.xs[removeIndex].inFm == 1)
                            return false;

                        var newTmFuns: tmFun[] = [];

                        if (currentState.xs[removeIndex].x instanceof fmPre)
                            (<fmPre> currentState.xs[removeIndex].x).tms.forEach(v => {
                                if (v instanceof tmFun)
                                    newTmFuns.push(<tmFun> v);
                            });

                        else if (currentState.xs[removeIndex].x instanceof tmFun)
                            (<tmFun> currentState.xs[removeIndex].x).tms.forEach(v => {
                                if (v instanceof tmFun)
                                    newTmFuns.push(<tmFun> v);
                            });

                        currentState.xs.splice(removeIndex, 1);

                        if (newTmFuns.length > 0) {

                            pushIndices(currentState.xs, removeIndex, newTmFuns.length * 2);

                            for (var i = 0; i < newTmFuns.length; i++) {
                                var tm = newTmFuns[i];

                                var unk1 = { x: tm, inFm: 1 };
                                var unk2 = { x: tm, inFm: 2 };

                                if (linkedUnks[i * 2] === undefined)
                                    linkedUnks[i * 2] = [];
                                if (linkedUnks[i * 2 + 1] === undefined)
                                    linkedUnks[i * 2 + 1] = [];

                                linkedUnks[i * 2].push(unk1);
                                linkedUnks[i * 2 + 1].push(unk2);

                                currentState.xs[i * 2 + removeIndex] = unk1;
                                currentState.xs[i * 2 + 1 + removeIndex] = unk2;
                            }
                        }
                    }

                    else {
                        console.log(currentState.xs[removeIndex]);
                        throw new Error("Expecting unknown term list, that is to be replaced");
                    }

                    return true;
                }
            });
        });
        
        // Set links between unknowns
        setLinkedUnks(linkedUnks);

        // Update the view
        update();
    }

    // Attach click handlers with previously defined callback functions
    $(document).on("click", "a.newTms",(e) => {

        indexUnknown = $(e.currentTarget).data("indexUnknown");

        newOverlay(e, "newTms", tmCallback);
    });

    $(document).on("click", "a.newTm",(e) => {

        indexUnknown = $(e.currentTarget).data("indexUnknown");

        newOverlay(e, "newTm", tmCallback);
    });

    $(document).on("click", "a.selectTerms", e => {
        indexUnknown = $(e.currentTarget).data("indexUnknown");

        var parentInductive = undefInductivesWithoutUnknowns[$(e.currentTarget).data("synUnknownIndex")];
        var x: Inductive;

        if (parentInductive.parent === null)
            x = currentState.p;
        else
            x = parentInductive.parent.premises[parentInductive.premiseIndex];

        termHandlerUniE(e, x);
    });
}


function addUnknownsPremises(x: Inductive, insertIndex: number): void {
    // Generate unknowns in premises based on selected rule
    // Rules listed just below have no new unknowns
    if (x instanceof synBool
        || x instanceof synImpI
        || x instanceof synDisI1
        || x instanceof synDisI2
        || x instanceof synConI
        || x instanceof synUniE
        || x instanceof synUniI)
        return;
    else if (x instanceof synImpE) {
        pushIndices(currentState.xs, insertIndex, 2);

        var unk1: Unknown = { x: x.premises[0].goal, inFm: 1 };
        var unk2: Unknown = { x: x.premises[1], inFm: 1, linkedTo: [unk1] };
        unk1.linkedTo = [unk2];

        currentState.xs[insertIndex] = unk1;
        currentState.xs[insertIndex + 1] = unk2;
    }

    else if (x instanceof synDisE) {
        pushIndices(currentState.xs, insertIndex, 4);

        var unk1: Unknown = { x: x.premises[0].goal, inFm: 1 };
        var unk2: Unknown = { x: x.premises[0].goal, inFm: 2 };
        var unk3: Unknown = { x: x.premises[1], inAssumption: x.premises[1].assumptions.length - 1, linkedTo: [unk1] };
        var unk4: Unknown = { x: x.premises[2], inAssumption: x.premises[2].assumptions.length - 1, linkedTo: [unk2] };

        unk1.linkedTo = [unk3];
        unk2.linkedTo = [unk4];

        currentState.xs[insertIndex] = unk1;
        currentState.xs[insertIndex + 1] = unk2;
        currentState.xs[insertIndex + 2] = unk3;
        currentState.xs[insertIndex + 3] = unk4;
    }

    else if (x instanceof synConE1) {
        pushIndices(currentState.xs, insertIndex, 1);
        currentState.xs[insertIndex] = { x: x.premises[0].goal, inFm: 2 };
    }

    else if (x instanceof synConE2) {
        pushIndices(currentState.xs, insertIndex, 1);
        currentState.xs[insertIndex] = { x: x.premises[0].goal, inFm: 1 };
    }

    else if (x instanceof synExiE) {
        pushIndices(currentState.xs, insertIndex, 1);
        currentState.xs[insertIndex] = { x: x.premises[0].goal, inFm: 1 };
    }

    else if (x instanceof synExiI) {
        var getQuantifiedVarsAsUnknowns: (x: any, p?: any, i?: number) => Unknown[] = (x, p = null, i = 0) => {

            var r: Unknown[] = [];

            if (x instanceof FormulaOneArg)
                r = getQuantifiedVarsAsUnknowns((<FormulaOneArg> x).fm, x);

            else if (x instanceof FormulaTwoArg)
                r = getQuantifiedVarsAsUnknowns((<FormulaTwoArg> x).lhs, x)
                    .concat(getQuantifiedVarsAsUnknowns((<FormulaTwoArg> x).rhs), x);

            else if (x instanceof fmPre) {
                (<fmPre> x).tms.forEach((e, j) => {
                    getQuantifiedVarsAsUnknowns(e, x, j).forEach(e => r.push(e));
                });
            }

            else if (x instanceof tmFun) {
                (<tmFun> x).tms.forEach((e, j) => {
                    getQuantifiedVarsAsUnknowns(e, x, j).forEach(e => r.push(e));
                });
            }

            else if (x === null && (p instanceof fmPre || p instanceof tmFun)) {
                var u: Unknown = { x: p, inTm: i };
                r.push(u);
            }

            else if (x instanceof Inductive) {
                r = getQuantifiedVarsAsUnknowns((<Inductive> x).goal, x);

                r.forEach(e => {
                    e.linkedTo = r.filter(k => k !== e);
                });
            }

            return r;
        };

        var quantifiedTerms = getQuantifiedVarsAsUnknowns(x.premises[0]);

        pushIndices(currentState.xs, insertIndex, quantifiedTerms.length);

        quantifiedTerms.forEach((e, i) => {
            currentState.xs[insertIndex + i] = e;
        });
    }

    else {
        console.log(x);
        throw new Error("Unexpected type of object, x");
    }
}

function replaceUnknownsFormula(u: Unknown, fm: Formula, updateLinked: boolean = true): Unknown[] {

    // Replace previous unknown with new formula
    if (u.x instanceof FormulaOneArg) {
        (<FormulaOneArg> u.x).fm = fm;
    }

    // Replacer either LHS or RHS of two argument formula
    else if (u.x instanceof FormulaTwoArg) {
        if (u.inFm == 1)
            (<FormulaTwoArg> u.x).lhs = fm;
        else
            (<FormulaTwoArg> u.x).rhs = fm;
    }

    // Set goal of new inductive
    else if (u.x instanceof Inductive) {
        if (u.inFm === 1)
            (<Inductive> u.x).goal = fm;
        else if (u.inAssumption !== undefined)
            (<Inductive> u.x).assumptions[u.inAssumption] = fm;

    }

    else {
        console.log(u);
        throw new Error("Expecting inductive, one argument formula or two argument formula.");
    }

    var unknowns: Unknown[] = [u];
    
    // Update linked unknowns
    if (updateLinked && u.linkedTo !== undefined)
        u.linkedTo.forEach(v => {
            replaceUnknownsFormula(v, fm, false).forEach(w => {
                unknowns.push(w);
            });
        });

    return unknowns;
}

function replaceUnknownsID(u: Unknown, id: string, updateLinked: boolean = true): Unknown[] {

    // Replace id of predicate
    if (u.x instanceof fmPre && u.inFm == 1) {
        (<fmPre> u.x).id = id;
    }

    // Replace id of function term
    else if (u.x instanceof tmFun && u.inFm == 1) {
        (<tmFun> u.x).id = id;
    }

    else {
        console.log(u);
        throw new Error("Expecting unknown ID in predicate or function");
    }

    var unknowns: Unknown[] = [u];
    
    // Update linked unknowns
    if (updateLinked && u.linkedTo !== undefined)
        u.linkedTo.forEach(v => {
            replaceUnknownsID(v, id, false).forEach(w => {
                unknowns.push(w);
            });
        });

    return unknowns;
}

function replaceUnknownsTm(u: Unknown, tmNats: number[], updateLinked: boolean = true): Unknown[] {

    if (u.x instanceof fmPre || u.x instanceof tmFun) {
        if (u.inFm === 1)
            return;

        var unknownTms: Term[];

        if (u.x instanceof fmPre) {
            if (u.inFm == 2)
                // Entire list of terms is unknown. Initialize list.
                (<fmPre> u.x).tms = [];

            unknownTms = (<fmPre> u.x).tms;
        }

        else {
            if (u.inFm == 2)
                // Entire list of terms is unknown. Initialize list.
                (<tmFun> u.x).tms = [];

            unknownTms = (<tmFun> u.x).tms;
        }

        tmNats.forEach(v => {
            if (v === -1) {
                var tmF = new tmFun(null, null);

                if (u.inFm === 2)
                    unknownTms.push(tmF);
                else if (u.inTm !== undefined)
                    unknownTms[u.inTm] = tmF;
            }

            else {
                var tmV = new tmVar(v);

                if (u.inFm === 2)
                    unknownTms.push(tmV);
                else if (u.inTm !== undefined)
                    unknownTms[u.inTm] = tmV;
            }
        });
    }

    else {
        console.log(u);
        throw new Error("Expecting unknown term list, that is to be replaced");
    }

    var unknowns: Unknown[] = [u];
    
    // Update linked unknowns
    if (updateLinked && u.linkedTo !== undefined)
        u.linkedTo.forEach(v => {
            replaceUnknownsTm(v, tmNats, false).forEach(w => {
                unknowns.push(w);
            });
        });

    return unknowns;
}


function termHandlerUniE(e: JQueryEventObject, x: Inductive) {
    // New overlay that lets you choose existing term to quantify
    newOverlay(e, "existingTerm",(ts: Term[]) => {
        if (ts.length == 0)
            return;

        if (!(x instanceof synUniE))
            return;

        prepareCurrentStateUpdate();

        (<synUniE> x).waitingForTermSelection = false;

        x.getPremises.apply(x, ts);

        update();
    }, x.goal);
}

//
// Html write
//

function appendLines(x: Inductive, n: number, i: number = 1): number {
    var htmlString: string = "<div class=\"line\">";

    // Line numbering
    htmlString += '<div class="lineNumber">' + i + '</div>';

    // Left
    htmlString += '<div class="left' + (!editModeOn ? ' hidden' : '') + '">';

    htmlString += '<div class="indentProof" data-indent="' + n + '">';

    htmlString += "<div class='synGoal'><div class='ok'>OK</div><div class='arg'>" + getIsaSyntax(x.goal) + "</div><div class='arg'><div class='leftBracket'>[</div>";

    // Assumptions
    var assumptionSyntaxLeft: string[] = [];
    var assumptionSyntaxRight: string[] = [];

    x.assumptions.forEach(v=> {
        assumptionSyntaxLeft.push(getIsaSyntax(v));
        assumptionSyntaxRight.push(getFormalSyntax(v, 0, null));
    });

    htmlString += assumptionSyntaxLeft.join(", ");

    htmlString += "<div class='rightBracket'>]</div></div></div></div></div>";
    // End left

    // Middle
    htmlString += '<div class="middle' + (!editModeOn ? ' shrink' : '') + '">' + getRuleName(x) + '</div>';
    // End middle

    // Right
    htmlString += '<div class="right' + (!editModeOn ? ' fill' : '') + '">';

    // Indention
    htmlString += '<div class="indentProof" data-indent="' + n + '">';
     
    // Assumptions
    htmlString += '<div class="assumptions"><div class="leftBracket">[</div>' + assumptionSyntaxRight.join('<div class="comma">,</div>') + '<div class="rightBracket">]</div></div>';

    // Goal
    htmlString += '<div class="goal">' + getFormalSyntax(x.goal, 0, null) + '</div>';
    htmlString += '</div>';

    htmlString += '</div>';
    // End right

    htmlString += '</div>';

    $(htmlString).appendTo("#frameContainer");

    i += 1;

    x.premises.forEach(v => {
        i = appendLines(v, n + 1, i);
    });

    // Write "news" line
    if (editModeOn)
        if (x.premises.length > 0 && (x instanceof synUniI || x instanceof synExiE && !(<synExiE> x).waitingForPCompletion)) {
            writeNewsLine(x, n + 1, i);
            i++;
        }

    return i;
}

function writeNewsLine(x: Inductive, n: number, i: number) {
    var htmlString: string = "<div class=\"line\">";

    // Line numbering
    htmlString += '<div class="lineNumber">' + i + '</div>';

    // Left
    htmlString += '<div class="left">';

    htmlString += '<div class="indentProof" data-indent="' + n + '">';

    // Write "news c <list>"
    htmlString += "<div class='synGoal'><div class='news'>news</div>";

    if (x instanceof synUniI)
        htmlString += '<div class="arg">' + getIsaSyntax((<synUniI> x).c) + '</div>';
    else if (x instanceof synExiE)
        htmlString += '<div class="arg">' + getIsaSyntax((<synExiE> x).c) + '</div>';

    htmlString += '<div class="arg leftParantheses">(</div>';

    var newsList: string[][] = [];

    if (x instanceof synExiE)
        newsList.push([getIsaSyntax((<fmExi> x.premises[0].goal).fm)]);

    if (x instanceof synUniI || x instanceof synExiE) {
        newsList.push([getIsaSyntax(x.goal)]);
    }

    newsList.push([]);
    x.assumptions.forEach(v=> {
        newsList[newsList.length - 1].push(getIsaSyntax(v));
    });

    var htmlAppend: string[] = [];

    newsList.forEach(v => {
        htmlAppend.push("<div class='leftBracket'>[</div>" + v.join('<div class="comma">,</div><wbr />') + "<div class='rightBracket'>]</div>");
    });


    htmlString += htmlAppend.join("<div class='concat'>#</div>");

    htmlString += '<div class="rightParantheses">)</div>';
    htmlString += '</div></div></div>';

    htmlString += '<div class="middle">news</div>';

    htmlString += '<div class="right">';

    htmlString += '<div class="indentProof" data-indent="' + n + '">';
    htmlString += '&nbsp;';
    htmlString += '</div>';

    htmlString += "</div>";

    $(htmlString).appendTo($("#frameContainer"));
}

//
// Search/replace functions
//

// Generic replace HTML shorthand function
var replaceHTML = (s: string, p: RegExp, r: string) => {
    $(s).each((i, e) => {
        $(e).html(($(e).html().replace(p, r)));
    });
}

function replaceUnknowns() {
    //
    // Code frame
    //

    replaceHTML("#frameContainer .line .left", /\@fm/g, "<a class=\"newFormula\" title=\"Unknown formula\">¤<\/a>");
    replaceHTML("#frameContainer .line .left", /\@id/g, "<a class=\"newID\" title=\"Unknown ID\">¤<\/a>");
    replaceHTML("#frameContainer .line .left", /\@tms/g, "<a class=\"newTms\" title=\"Unknown list of terms\">¤<\/a>");
    replaceHTML("#frameContainer .line .left", /\@tm/g, "<a class=\"newTm\" title=\"Unknown term\">¤<\/a>");

    // @syn -> 
    // if (syn has no unknowns in goal) -> link to select syn rule
    // else -> remove
    $("#frameContainer .line .middle").filter((i, v) => { return $(v).html().search("news") === -1 }).each((i, e) => {
        if (undefInductivesWithoutUnknowns[i] !== undefined) {
            $(e).html($(e).html().replace(/\@syn/, "<a class='newSynRule' title='Unknown rule'>¤</a>"));
        }
        else
            $(e).html("&nbsp;");
    });

    //
    // Formal frame
    //

    replaceHTML("#frameContainer .line .right", /\@fm/g, '<span title="Unknown formula" class="formalUnknown">¤</span>');
    replaceHTML("#frameContainer .line .right", /\@id/g, '<span title="Unknown ID" class="formalUnknown">¤</span>');
    replaceHTML("#frameContainer .line .right", /\@tms/g, '<span title="Unknown list of terms" class="formalUnknown">¤</span>');
    replaceHTML("#frameContainer .line .right", /\@tm/g, '<span title="Unknown term" class="formalUnknown">¤</span>');
}

function replaceFormalSymbols(selection: string): void {
    $(selection).each((i, e) => {
        // False/bottom
        $(e).html(($(e).html().replace(/\@false/g, '&perp;')));

        // Imp
        $(e).html(($(e).html().replace(/\@imp/g, '&rarr;')));

        // Con
        $(e).html(($(e).html().replace(/\@con/g, '&and;')));

        // Dis
        $(e).html(($(e).html().replace(/\@dis/g, '&or;')));

        // Exi
        $(e).html(($(e).html().replace(/\@exi\{([^\}])\}/g, '&exist;$1.')));

        // Uni
        $(e).html(($(e).html().replace(/\@uni\{([^\}]+)\}/g, '&forall;$1.')));

        // Subscript
        $(e).html(($(e).html().replace(/\*/g, '\'')));
    });
}

function replaceFormatSpecialCodes(): void {
    $(".line .middle").each((i, e) => {
        $(e).html($(e).html().replace(/@true:assume/, '<span title="Goal is in list of assumptions.">Assume</span>'));
        $(e).html($(e).html().replace(/Exi_E:incomplete/, '<span title="Complete definition of unknown formula p to generate remaining premises.">Exi_E (!)</span>'));
        $(e).html($(e).html().replace(/Uni_E:incomplete/, '<a title="Complete selection of terms to quantify." class="selectTerms">Uni_E (!)</a>'));
        $(e).html($(e).html().replace(/news/, '&nbsp;'));
    });

}



//
// Misc
//

function updateExistingIndexUnknowns() {
    // Update the indices of the HTML elements of unknowns
    $("#frameContainer .line .left a").not(".newSynRule").each((i, e) => {
        $(e).data("indexUnknown", i);
    });

    $(".middle").each((i, e) => {
        $("a", e).data("synUnknownIndex", i);
    });
}


var editModeOn = false;

function attachMenuEvents() {
    // Attach click handlers to menu elements
    $("#header .load").on("click", e => {
        closeOverlays();

        newCenteredOverlay("load",(x: Inductive[]) => loadProof(x));
    });

    $("#header .edit").on("click", e => {
        editModeOn = !editModeOn;

        if (editModeOn) {
            // Is now toggled
            $(e.currentTarget).addClass("editHover");
        } else {
            // Is now untoggled
            $(e.currentTarget).removeClass("editHover");
        }

        update();
    });

    $("#header .help").on("click", e => {
        newCenteredOverlay("help",() => { });
    });

    $(document).ready(function () {
        if (!window.location.hash)
            $("#header .help").click();
    });
}

function attachHashEventListeners() {
    // Check for browser support
    if (!("onhashchange" in window)) {
        console.log("Cannot load proofs through hash event listener: No browser support.");
        return;
    }

    // Hash change event
    $(window).on("hashchange",() => {
        // No hash value
        if (!window.location.hash)
            return;

        // Remove leading #
        var hashValue = window.location.hash.substring(1);

        // Match against number value
        var match = hashValue.search(/^([0-9]+)$/) !== -1;

        // No match
        if (!match)
            return;

        var proofID = "Hint " + hashValue;

        if (proofCodes[proofID] === undefined)
            return;

        var proof = decodeProof(proofCodes[proofID]);

        if (proof !== null) {
            closeAllOverlays();

            loadProof(proof, true);
        }
    });
}


/*
 * New overlay
 */

function newOverlay(t: JQueryEventObject, type: string, cb: (...input) => any, ...input): void {
    var overlay = $("<div class=\"overlay\" style=\"display: none;\"></div > ");

    // Position overlay at position of clicked element
    var coords = $(t.currentTarget).offset();
    overlay.css({
        position: "absolute",
        left: (coords.left + 15) + "px",
        top: (coords.top + 15) + "px"
    });

    $("body").append(overlay);

    switch (type) {
        case "newSynRule":
            /* Remove old overlays */
            closeOverlays(overlay);

            addInnerNewSynRule(overlay, cb, input[0]);
            break;
        case "newFormula":
            closeOverlays(overlay);

            addInnerNewFormula(overlay, cb);
            break;
        case "newID":
            closeOverlays(overlay);

            addInnerNewID(overlay, cb);
            break;
        case "newTms":
            closeOverlays(overlay);

            addInnerNewTms(overlay, cb);
            break;
        case "newTm":
            closeOverlays(overlay);

            addInnerNewSingleTm(overlay, cb);
            break;
        case "existingTerm":
            closeOverlays(overlay);

            selectExistingTerm(overlay, cb, input[0]);
            break;
        default:
            throw new Error("Could not get overlay of type: " + type);
    }

    overlay.prepend("<div class=\"closeOverlay\">X</div>");
    overlay.show();

    $(".closeOverlay", overlay).click(function (e) {
        closeOverlays();
    });
}

function closeOverlays(...exceptions: JQuery[]) {
    var selection = $(".overlay");

    exceptions.forEach((v) => {
        selection = selection.not(v);
    });

    selection.remove();
};

function closeAllOverlays() {
    closeOverlays();
    $(".centeredOverlayOuter").remove();
}

//
// New centered overlay
//

function newCenteredOverlay(olType: string, cb: (...input) => any, ...input): void {
    var outer = $("<div class=\"centeredOverlayOuter\"></div>");

    var content = $("<div class=\"overlay\"></div>");

    content.hide();

    outer.append(content);
    $("body").append(outer);

    switch (olType) {
        case "load":

            loadInner(content, cb);

            break;
        case "help":

            helpInner(content, cb);

            break;
        default:
            throw new Error("Could not get overlay of type: " + olType);

    }

    content.prepend("<div class=\"closeCenteredOverlay\"><div>X</div></div>");
    content.show();

    $(".closeCenteredOverlay", content).click(function (e) {
        $(outer).remove();
    });
}

/*
 * The different overlays
 */

function addInnerNewSynRule(overlay: JQuery, callback: (x: Inductive) => void, y: Inductive): void {
    var r = $("<div></div>");
    overlay.append(r);

    // Only add applicable rules to list of options
    if (synBool.isApplicable(y.goal))
        r.append("<a class=\"newSynBoole\">Boole</a><br />");

    if (synImpE.isApplicable(y.goal))
        r.append("<a class=\"newSynImpE\">Imp_E</a><br />");

    if (synImpI.isApplicable(y.goal))
        r.append("<a class=\"newSynImpI\">Imp_I</a><br />");
    if (synDisE.isApplicable(y.goal))
        r.append("<a class=\"newSynDisE\">Dis_E</a><br />");

    if (synDisI1.isApplicable(y.goal))
        r.append("<a class=\"newSynDisI1\">Dis_I1</a><br />");

    if (synDisI2.isApplicable(y.goal))
        r.append("<a class=\"newSynDisI2\">Dis_I2</a><br />");

    if (synConE1.isApplicable(y.goal))
        r.append("<a class=\"newSynConE1\">Con_E1</a><br />");

    if (synConE2.isApplicable(y.goal))
        r.append("<a class=\"newSynConE2\">Con_E2</a><br />");

    if (synConI.isApplicable(y.goal))
        r.append("<a class=\"newSynConI\">Con_I</a><br />");

    if (synExiE.isApplicable(y.goal))
        r.append("<a class=\"newSynExiE\">Exi_E</a><br />");

    if (synExiI.isApplicable(y.goal))
        r.append("<a class=\"newSynExiI\">Exi_I</a><br />");

    if (synUniE.isApplicable(y.goal))
        r.append("<a class=\"newSynUniE\">Uni_E</a><br />");

    if (synUniI.isApplicable(y.goal))
        r.append("<a class=\"newSynUniI\">Uni_I</a><br />");


    $("a", r).click(function (e) {
        // Initialize structure of selected rule and send it to callback
        var newIndClass: Inductive;

        var className: String = $(e.currentTarget).prop("class").split(/\s+/).shift();

        if (className === "newSynBoole") {
            newIndClass = new synBool(y.goal, y.assumptions);
        }

        else if (className === "newSynImpE") {
            newIndClass = new synImpE(y.goal, y.assumptions);
        }

        else if (className === "newSynImpI") {
            newIndClass = new synImpI(y.goal, y.assumptions);
        }

        else if (className === "newSynDisE") {
            newIndClass = new synDisE(y.goal, y.assumptions);
        }

        else if (className === "newSynDisI1") {
            newIndClass = new synDisI1(y.goal, y.assumptions);
        }

        else if (className === "newSynDisI2") {
            newIndClass = new synDisI2(y.goal, y.assumptions);
        }

        else if (className === "newSynConE1") {
            newIndClass = new synConE1(y.goal, y.assumptions);
        }

        else if (className === "newSynConE2") {
            newIndClass = new synConE2(y.goal, y.assumptions);
        }

        else if (className === "newSynConI") {
            newIndClass = new synConI(y.goal, y.assumptions);
        }

        else if (className === "newSynExiE") {
            newIndClass = new synExiE(y.goal, y.assumptions);
        }

        else if (className === "newSynExiI") {
            newIndClass = new synExiI(y.goal, y.assumptions);
        }

        else if (className === "newSynUniE") {
            newIndClass = new synUniE(y.goal, y.assumptions);
        }

        else if (className === "newSynUniI") {
            newIndClass = new synUniI(y.goal, y.assumptions);
        }

        closeOverlays();

        callback(newIndClass);
    });
}

function addInnerNewFormula(overlay: JQuery, callback: (x: Formula) => void): void {
    var r = $("<div></div>");
    overlay.append(r);

    r.append("<div>Formulas:</div>");
    r.append("<a class=\"newFmFalsity\">Falsity</a><br />");
    r.append("<a class=\"newFmPre\">Predicate</a><br />");
    r.append("<a class=\"newFmImp\">Implication</a><br />");
    r.append("<a class=\"newFmDis\">Disjunction</a><br />");
    r.append("<a class=\"newFmCon\">Conjunction</a><br />");
    r.append("<a class=\"newFmExi\">Existential Quantifier</a><br />");
    r.append("<a class=\"newFmUni\">Universal Quantifier</a>");

    $("a", r).click(function (e) {

        var newFm: Formula;

        var className: String = $(e.currentTarget).prop("class").split(/\s+/).shift();

        if (className === "newFmFalsity") {
            newFm = new fmFalsity();
        }

        else if (className === "newFmPre") {
            newFm = new fmPre(null, null);
        }

        else if (className === "newFmImp") {
            newFm = new fmImp(null, null);
        }

        else if (className === "newFmDis") {
            newFm = new fmDis(null, null);
        }

        else if (className === "newFmCon") {
            newFm = new fmCon(null, null);
        }

        else if (className === "newFmExi") {
            newFm = new fmExi(null);
        }

        else if (className === "newFmUni") {
            newFm = new fmUni(null);
        }

        callback(newFm);

        closeOverlays();
    });
}


function addInnerNewID(overlay: JQuery, callback: (x: string) => void): void {
    var r = $("<div></div>");
    overlay.append(r);

    r.append("<div>New ID:</div>");
    var select = $("<select></select>");
    r.append(select);

    for (var i = 65; i <= 90; i++) {
        select.append("<option>" + String.fromCharCode(i) + "</option>");
    }

    for (var i = 97; i <= 122; i++) {
        select.append("<option>" + String.fromCharCode(i) + "</option>");
    }

    r.append("<div><input type=\"submit\" value=\"Done\" /></div>");

    $(":submit", r).click(function (e) {

        var newID: string = $("select", r).val();

        callback(newID);

        closeOverlays();
    });
}


function addInnerNewTms(overlay: JQuery, callback: (x: number[]) => void): void {
    var r = $("<div></div>");
    overlay.append(r);

    r.append("<div>New list of terms:</div>");

    var terms = r.append("<div class=\"terms\"></div>");
    var select = $("<select style='display: block;'></select>");

    select.append("<option value='-1'>Function</option>");
    select.append("<optgroup label='Variable'>");
    for (var i = 0; i <= 20; i++) {
        select.append("<option>" + i + "</option>");
    }
    select.append("</optgroup>");

    r.append("<div class=\"buttons\">");
    r.append("<input type=\"submit\" value=\"Done\" />");
    r.append("<input type=\"button\" class=\"addTerm\" value=\"Add term\" />");
    r.append("<input type=\"button\" class=\"removeTerm\" value=\"Remove last term\" />");
    r.append("</div>");

    $(":submit", r).click(function (e) {

        var tms: number[] = [];
        var test: boolean[] = [];

        // Check if same term has been selected more than once
        var interrupt = false;
        $("select", r).each((i, e) => {
            var v = parseInt($(e).val(), 10);

            tms.push(v);

            if (v === -1)
                return true;

            if (test[v] === true) {
                alert("Same variable selected multiple times");
                interrupt = true;
                return false;
            }

            test[v] = true;
        });

        if (interrupt)
            return false;

        callback(tms);

        closeOverlays();
    });

    $(".addTerm:button").click(() => {
        select.clone().val("").appendTo($(".terms", r));
    });

    $(".removeTerm:button").click(() => {
        $("select:last", $(".terms", r)).remove();
    });
}


function addInnerNewSingleTm(overlay: JQuery, callback: (x: number[]) => void): void {
    var r = $("<div></div>");
    overlay.append(r);

    r.append("<div>New term:</div>");

    var terms = r.append("<div class=\"terms\"></div>");
    var select = $("<select style='display: block;'></select>");

    select.append("<option value='-1'>Function</option>");
    select.append("<optgroup label='Variable'>");
    for (var i = 0; i <= 20; i++) {
        select.append("<option>" + i + "</option>");
    }
    select.append("</optgroup>");

    select.appendTo($(".terms", r));

    r.append("<div class=\"buttons\">");
    r.append("<input type=\"submit\" value=\"Done\" />");
    r.append("</div>");

    $(":submit", r).click(function (e) {
        var v = parseInt($("select", r).val(), 10);

        callback([v]);

        closeOverlays();
    });
}


function selectExistingTerm(overlay: JQuery, callback: (x: Term[]) => void, p: Formula): void {
    var r = $("<div></div>");
    overlay.append(r);

    r.append("<div>Formula:</div>");
    r.append('<div class="formula">' + getFormalSyntax(p, 0, null) + '</div><br />');

    r.append("<div>Existing term in formula to quantify:</div>");

    var terms = r.append("<div class=\"terms\"></div>");

    var select = $("<select></select>");
    var selectVars = $('<optgroup label="Variables"></optgroup>');
    var selectFns = $('<optgroup label="Functions"></optgroup>');

    select.append(selectVars);
    select.append(selectFns);

    // Link terms occuring multiple times 
    var ts: { t: Term; linkedTo: Term[] }[] = [];

    getTerms(p).forEach(e => {
        var x: { t: Term; linkedTo: Term[] };

        ts.some(d => {
            if (equalFormulas(d.t, e)) {
                x = d;
                return true;
            }
        });

        if (x === undefined) {
            ts.push({ t: e, linkedTo: [] });
        } else {
            x.linkedTo.push(e);
        }
    });

    // Add each term to list of functions or list of variables (term types)
    ts.forEach((e, i) => {
        (e.t instanceof tmVar ? selectVars : selectFns)
            .append("<option value='" + i + "'>" + getFormalSyntax(e.t, 0, null) + "</option>");
    });

    // Append select to overlay
    select.appendTo(terms);

    // Add button to close overlay
    r.append('<br /><div><input type="button" value="Ok" />');

    // Select onChange handler
    $(select).on("change", e => {
        // Remove any existing term occurence selectors
        $("div.selectOccurences", r).remove();

        // Get index of chosen term in list
        var i: number = $(e.currentTarget).val();

        if (ts[i].linkedTo.length > 0) {
            // Create and add new div
            var o = $('<div class="selectOccurences"></div>');
            select.after(o);

            o.append("<br /><div>Select occurences</div>");

            for (var k = 0; k < ts[i].linkedTo.length + 1; k++) {
                o.append((k + 1) + '. <input type="checkbox" checked /><br />');
            }
        }

    }).change();

    // Button click handler
    $(":button", r).on("click", e => {
        // Get chosen occurences, if needed
        var i: number = select.val();

        var cbTs: Term[] = [];

        if (ts[i].linkedTo.length == 0)
            cbTs.push(ts[i].t);

        else {
            $(":checkbox", r).each((j, e) => {
                if ($(e).prop("checked"))
                    cbTs.push(j == 0 ? ts[i].t : ts[i].linkedTo[j - 1]);
            });
        }

        // Simple error check: Make sure that term list is not empty
        if (cbTs.length == 0)
            alert("You have not selected any occurences of the term to quantify");
        else {
            callback(cbTs);
            closeOverlays();
        }
    });

    replaceFormalSymbols(".overlay.formula");
}

function loadInner(overlay: JQuery, callback: (x: Inductive[]) => void): void {
    // Main div to contain contents
    var content = $("<div class=\"flexContentY\"></div>");
    overlay.append(content);

    // Make menu buttons (contained in a div)
    var buttonsContainer = $("<div class=\"buttonContainer\"></div>");
    var buttonsTable = $("<div class=\"buttonsTable\"></div>");
    var buttonsRow = $("<div class=\"buttonsRow\"></div>");

    var btnLeft = $('<div class="btnLeft"></div>');
    var btnMid = $('<div class="btnMid"></div>');
    var btnRight = $('<div class="btnRight"></div>');

    buttonsRow.append(btnLeft);
    buttonsRow.append(btnMid);
    buttonsRow.append(btnRight);

    buttonsContainer.append(buttonsTable);
    buttonsTable.append(buttonsRow);

    var cancel = $('<div class="button small">Cancel load</div>');
    var update = $('<div class="button small">Load shown proof</div>');
    var presentProof = $('<div class="button small">The present proof</div>');
    //var makeNewProof = $('<div class="button small">The blank proof</div>');

    btnLeft.append(cancel);
    btnMid.append(presentProof);
    btnRight.append(update);

    // Example buttons
    var examplesJQuery: JQuery[] = [];

    for (var i = 0; i <= 9; i++) {
        examplesJQuery[i] = $('<div class="button small exampleProof">Test ' + i + '</div>');
        examplesJQuery[i].data("ithExample", i);

        btnMid.append(examplesJQuery[i]);
    }

    var testSuite = $('<div class="button small exampleProof">Test suite</div>');
    btnMid.append(testSuite);

    var onlineProofs = $('<div class="button small exampleProof">Online proofs</div>');
    btnMid.append(onlineProofs);

    //btnMid.append(makeNewProof);

    content.append(buttonsContainer);

    // Textarea
    var textareaContainer = $('<div class="loadTextareaContainer"></div>');

    var textarea = $("<textarea class=\"loadTextarea\" spellcheck='false'></textarea>");

    textareaContainer.append(textarea);
    content.append(textareaContainer);

    // Apply button events
    cancel.click(e => {
        $(".closeCenteredOverlay", overlay).trigger("click");
    });

    update.click(e => {
        var proofString = (<string> textarea.val()).trim();

        if (proofString == "")
            proofString = INITIAL_PROOF;

        var newProofs = decodeProof(proofString);

        if (newProofs === undefined || newProofs === null) {
            textarea.css({ borderColor: "red" });

            setTimeout(() => {
                textarea.css({ borderColor: "blue" });
            }, 2000);

        } else {
            callback(newProofs);

            cancel.trigger("click");
        }
    });
    
    // Click handler to insert correct proof code on example button click
    $(".exampleProof").on("click", v => {
        if ($(v.currentTarget).data("ithExample") !== undefined)
            textarea.val(proofCodes["Test " + $(v.currentTarget).data("ithExample")]);

        else if ($(v.currentTarget).html() === "Test suite")
            textarea.val(proofCodes["Test suite"]);

        else if ($(v.currentTarget).html() === "Online proofs")
            textarea.val(proofCodes["Online proofs"]);
    });

    // Present proof code with prepended comment lines
    var presentProofCode = ". The present proof is stored in the code shown here.\n. Use text copy-and-paste to a file in order to save it.\n. The proof code can be edited or replaced entirely.\n. A line like this one starting with a period is a comment only.\n.\n";

    for (var i = stateStack.stack.length - 1; i >= 0; i--)
        presentProofCode += encodeProof(stateStack.stack[i].p) + "\n";

    presentProofCode = presentProofCode.substr(0, presentProofCode.length - 1);

    presentProof.on("click",() => {
        textarea.val(presentProofCode);
    });

    // Add hover effect to active button
    $(".btnLeft, .btnMid, .btnRight").children().on("click",() => {
        $(".btnMid").children().removeClass("buttonMidHover");
    });

    $(".btnMid").children().on("click", e => $(e.currentTarget).addClass("buttonMidHover"));

    presentProof.trigger("click");
};


var firstHelpClick = true;

function helpInner(overlay: JQuery, callback: () => void): void {
    // Flexible content
    var content = $("<div class=\"flexContentY\"></div>");
    overlay.append(content);

    // Make menu buttons
    var buttonsContainer = $("<div class=\"buttonContainer\"></div>");
    var buttonsTable = $("<div class=\"buttonsTable\"></div>");
    var buttonsRow = $("<div class=\"buttonsRow\"></div>");

    var btnLeft = $('<div class="btnLeft"></div>');
    var btnMid = $('<div class="btnMid"></div>');
    var btnRight = $('<div class="btnRight"></div>');

    buttonsRow.append(btnLeft);
    buttonsRow.append(btnMid);
    buttonsRow.append(btnRight);

    buttonsContainer.append(buttonsTable);
    buttonsTable.append(buttonsRow);

    var cancel = $('<div class="button small">Cancel help</div>');
    var folButton = $('<div class="button small">Definition of first-order logic syntax and semantics</div>');
    var ndButton = $('<div class="button small">Definition of natural deduction proof system</div>');
    var sampleButton = $('<div class="button small">Sample proofs and exercises with hints</div>');
    var welcomeButton = $('<div class="button small">Show welcome help</div>');

    btnLeft.append(cancel);
    btnMid.append(ndButton);
    btnMid.append(folButton);
    btnMid.append(sampleButton);
    btnRight.append(welcomeButton);

    content.append(buttonsContainer);

    // Content box
    var helpContent = $('<div class="helpContent"></div>');
    content.append(helpContent);

    var paranthesesBracketReplace = (s: string) => {
        return s.replace(/\(/gm, '<div class="leftParantheses">(</div>')
            .replace(/\)/gm, '<div class="rightParantheses">)</div>')
            .replace(/\[/gm, '<div class="leftBracket">[</div>')
            .replace(/\]/gm, '<div class="rightBracket">]</div>');
    }


    // Table of rules (function is made to generate the tables in a more generic way)
    var getRuleTable = (name: string, premises: string[], goal: string) => {
        var ndContentStr = "";
        ndContentStr += '<table cellpadding="0" cellspacing="0" border="0" class="ndRule">';
        ndContentStr += '<tr class="premises">';
        premises.forEach(v=> {
            ndContentStr += '<td>' + paranthesesBracketReplace(v) + '</td>';
        });
        ndContentStr += '<td>&nbsp;</td>';
        ndContentStr += '</tr>';
        ndContentStr += '<tr>';
        ndContentStr += '<td colspan="' + premises.length + '">';
        ndContentStr += '<table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">';
        ndContentStr += '<tr>';
        ndContentStr += '<td><div class="thinline"></div></td>';
        ndContentStr += '</tr>';
        ndContentStr += '</table>';
        ndContentStr += '</td>';
        ndContentStr += '<td class="name"">' + name + '</td>';
        ndContentStr += '</tr>';
        ndContentStr += '<tr>';
        ndContentStr += '<td colspan="' + premises.length + '" class="goal">' + paranthesesBracketReplace(goal) + '</td>';
        ndContentStr += '<td>&nbsp;</td>';
        ndContentStr += '</tr>';
        ndContentStr += '</table>';

        return ndContentStr;
    };

    // Tabs
    /* Content: Welcome */
    var welcomeContent = $('<div><div class="headline">Welcome to NaDeA: A Natural Deduction Assistant with a Formalization in Isabelle</div><div class="textline">NaDeA runs in a standard browser - preferably in full screen - and is open source software - please find the source code and further information here: http://logic-tools.github.io/ </div><div class="textline">The escape key can always be pressed to cancel and go to the main window where the Help button brings up the help window (this welcome help is also available).</div><div class="textline">Also in the main window the Load button brings up the load window which allows for simple import/export of proof code (the whole proof history is shown).</div><div class="textline extraSpace">In order to edit a proof, the Edit button in the main window can be used to turn the edit mode on and off (by default the edit mode is turned off).</div><div class="textline extraSpace">Please provide feedback to Associate Professor Jørgen Villadsen, DTU Compute, Denmark: http://people.compute.dtu.dk/jovi/ </div><div class="textline codeBlock"><strong>Notes</strong></div><div class="textline codeBlock">OK p a: The formula p follows from the assumptions a.</div><div class="textline codeBlock">news c l: True if the identifier c does not occur in the list of formulas l.</div><div class="textline codeBlock extraSpace">sub n t p: Returns the formula p where the term t has been substituted for the variable with the de Bruijn index n.<br /></div><div class="textline codeBlock"><strong>Copyright notice and disclaimer</strong></div><div class="codeBlock">Copyright &copy; 2015 Jørgen Villadsen, Alexander Birch Jensen &amp; Anders Schlichtkrull<br /><br />Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:<br /><br />The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.<br /><br />THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</div></div>');


    /* Content: Def. of syntax and semantics */
    var dssContent = $('<div></div>');
    dssContent.append(paranthesesBracketReplace('<div class="codeBlock"><div class="textline extraSpace">The natural deduction proof system assumes the following definition of first-order logic syntax and semantics:</div><div class="textline"><strong>Syntax</strong></div><div class="textline extraSpace">Identifiers are strings used as functions and predicates.</div><div class="textline lessSpace\">identifier <span class=\"eqdef\">:=</span> string</div><div class="textline lessSpace\">term <span class=\"eqdef\">:=</span> Var nat <span class=\"delimiter\">|</span> Fun identifier [term, ..., term]</div><div class="textline lessSpace\">formula <span class=\"eqdef\">:=</span> Falsity <span class=\"delimiter\">|</span> Pre identifier [term, ..., term] <span class=\"delimiter\">|</span> <span>Imp</span> formula formula <span class=\"delimiter\">|</span> <span>Dis</span> formula formula <span class=\"delimiter\">|</span> <span>Con</span> formula formula <span class=\"delimiter\">|</span> <span>Exi</span> formula <span class=\"delimiter\">|</span> <span>Uni</span> formula<br /></div><br /><div class="textline">The quantifiers use de Bruijn indices and truth, negation and biimplication are abbreviations.</div><br /><div class="textline"><strong>Semantics</strong></div><div class="textline extraSpace">The domain of quantification is implicit in the environment ´e´ for variables and in the function semantics ´f´ and predicate semantics ´g´ of arbitrary arity.</div></div><div class="leftColumn noTopMargin codeBlock">semantics_term e f (Var v) <span class=\"eqdef\">=</span> e v<br />semantics_term e f (Fun i l) <span class=\"eqdef\">=</span> f i (semantics_list e f l)<br /><br />semantics_list e f [] <span class=\"eqdef\">=</span> []<br />semantics_list e f (t # l) <span class=\"eqdef\">=</span> semantics_term e f t <span class=\"headtail\">#</span> semantics_list e f l<br /><div class="textline"><br />Operator # is between the head and the tail of a list.</div></div><div class="rightColumn noTopMargin codeBlock">semantics e f g Falsity <span class=\"eqdef\">=</span> False<br />semantics e f g (Pre i l) <span class=\"eqdef\">=</span> g i (semantics_list e f l)<br />semantics e f g (<span class="impFm">Imp</span> p q) <span class=\"eqdef\">=</span> (if semantics e f g p then semantics e f g q else True)<br />semantics e f g (<span class="disFm">Dis</span> p q) <span class=\"eqdef\">=</span> (if semantics e f g p then True else semantics e f g q)<br />semantics e f g (<span class="conFm">Con</span> p q) <span class=\"eqdef\">=</span> (if semantics e f g p then semantics e f g q else False)<br />semantics e f g (<span class="exiFm">Exi</span> p) <span class=\"eqdef\">=</span> (<span class=\"qmark\">?</span> x. semantics (% n. if n = 0 then x else e (n - 1)) f g p)<br />semantics e f g (<span class="uniFm">Uni</span> p) <span class=\"eqdef\">=</span> (<span class=\"exmark\">!</span> x. semantics (% n. if n = 0 then x else e (n - 1)) f g p)<br /><br /></div><div class="clear"></div><div class="codeBlock"><div class="textline">Operator % is for lambda abstraction, operator ! is for universal quantification and operator ? is for existential quantification.</div><br /><div class="textline extraSpace">All meta-variables are implicitly universally quantified in the following derived rule connecting the provability predicate ´OK´ and the semantics:</div>') + '<div class="ndRulesContainer first">' + getRuleTable("Soundness", ["OK p []"], "semantics e f g p") + '<div class="clear"></div></div></div><br /><div class="textline">The computer-checked soundness proof is provided in the Isabelle theory file here: https://github.com/logic-tools/nadea</div>');

    /* Sample proofs and exercises with hints */
    var sampleContent = $('<div class="codeBlock textline"><strong>MORE TO COME</strong></div>');

    /* Summary of rules */
    var sorContent = $('<div></div>');

    sorContent.append('<div class="textline codeBlock extraSpace">The natural deduction proof system is defined by the inductive provability predicate ´OK´ and the auxiliary primitive recursive functions ´news´ (new identifier in formulas) and ´sub´ (substitution for variable in formula):</div>');

    // Rule tables are created.

    var divBox1 = $('<div class="ndRulesContainer first"></div>');
    var divBox2 = $('<div class="ndRulesContainer"></div>');
    var divBox3 = $('<div class="ndRulesContainer"></div>');

    divBox1.append(getRuleTable("Assume", ["member p a"], "OK p a"));
    divBox1.append(getRuleTable("Boole", ["OK Falsity ((Imp p Falsity) # a)"], "OK p a"));
    divBox1.append(getRuleTable("Imp_E", ["OK (Imp p q) a", "OK p a"], "OK q a"));
    divBox1.append(getRuleTable("Imp_I", ["OK q (p # a)"], "OK (Imp p q) a"));
    divBox1.append('<div class="floatRight">Operator # is between the head and the tail of a list.</div>');

    divBox2.append(getRuleTable("Dis_E", ["OK (Dis p q) a", "OK r (p # a)", "OK r (q # a)"], "OK r a"));
    divBox2.append(getRuleTable("Dis_I1", ["OK p a"], "OK (Dis p q) a"));
    divBox2.append(getRuleTable("Dis_I2", ["OK q a"], "OK (Dis p q) a"));
    divBox2.append(getRuleTable("Con_E1", ["OK (Con p q) a"], "OK p a"));
    divBox2.append(getRuleTable("Con_E2", ["OK (Con p q) a"], "OK q a"));
    divBox2.append(getRuleTable("Con_I", ["OK p a", "OK q a"], "OK (Con p q) a"));

    divBox3.append(getRuleTable("Exi_E", ["OK (Exi p) a", "OK q ((sub 0 (Fun c []) p) # a)", "news c (p # q # a)"], "OK q a"));
    divBox3.append(getRuleTable("Exi_I", ["OK (sub 0 t p) a"], "OK (Exi p) a"));
    divBox3.append(getRuleTable("Uni_E", ["OK (Uni p)"], "OK (sub 0 t p) a"));
    divBox3.append(getRuleTable("Uni_I", ["OK (sub 0 (Fun c []) p) a", "news c (p # a)"], "OK (Uni p) a"));

    sorContent.append(divBox1);
    sorContent.append(divBox2);
    sorContent.append(divBox3);

    sorContent.append('<div class="clear"></div>');

    // Content: Summary of rules
    sorContent.append(paranthesesBracketReplace('<div class=\"leftColumn codeBlock\">member p [] = False<br />member p (q # a) <span class=\"eqdef\">=</span> (if p = q then True else member p a)<br /><br />new_term c (Var v) <span class=\"eqdef\">=</span> True<br />new_term c (Fun i l) <span class=\"eqdef\">=</span> (if i = c then False else new_list c l)<br /><br />new_list c [] <span class=\"eqdef\">=</span> True<br />new_list c (t # l) <span class=\"eqdef\">=</span> (if new_term c t then new_list c l else False)<br /><br />new c Falsity <span class=\"eqdef\">=</span> True<br />new c (Pre i l) <span class=\"eqdef\">=</span> new_list c l<br />new c (<span class="impFm">Imp</span> p q) <span class=\"eqdef\">=</span> (if new c p then new c q else False)<br />new c (<span class="disFm">Dis</span> p q) <span class=\"eqdef\">=</span> (if new c p then new c q else False)<br />new c (<span class="conFm">Con</span> p q) <span class=\"eqdef\">=</span> (if new c p then new c q else False)<br />new c (<span class="exiFm">Exi</span> p) <span class=\"eqdef\">=</span> new c p<br />new c (<span class="uniFm">Uni</span> p) <span class=\"eqdef\">=</span> new c p<br /><br />news c [] <span class=\"eqdef\">=</span> True<br />news c (p # a) <span class=\"eqdef\">=</span> (if new c p then news c a else False)</div><div class=\"rightColumn codeBlock\">inc_term (Var v) <span class=\"eqdef\">=</span> Var (v + 1)<br />inc_term (Fun i l) <span class=\"eqdef\">=</span> Fun i (inc_list l)<br /><br />inc_list [] <span class=\"eqdef\">=</span> []<br />inc_list (t # l) <span class=\"eqdef\">=</span> inc_term t <span class=\"headtail\">#</span> inc_list l<br /><br />sub_term n s (Var v) <span class=\"eqdef\">=</span> (if v = n then s else if v > n then Var (v - 1) else Var v)<br />sub_term n s (Fun i l) <span class=\"eqdef\">=</span> Fun i (sub_list n s l)<br /><br />sub_list n s [] <span class=\"eqdef\">=</span> []<br />sub_list n s (t # l) <span class=\"eqdef\">=</span> sub_term n s t <span class=\"headtail\">#</span> sub_list n s l<br /><br />sub n s Falsity <span class=\"eqdef\">=</span> Falsity<br />sub n s (Pre i l) <span class=\"eqdef\">=</span> Pre i (sub_list n s l)<br />sub n s (<span class="impFm">Imp</span> p q) <span class=\"eqdef\">=</span> <span class="impFm">Imp</span> (sub n s p) (sub n s q)<br />sub n s (<span class="disFm">Dis</span> p q) <span class=\"eqdef\">=</span> <span class="disFm">Dis</span> (sub n s p) (sub n s q)<br />sub n s (<span class="conFm">Con</span> p q) <span class=\"eqdef\">=</span> <span class="conFm">Con</span> (sub n s p) (sub n s q)<br />sub n s (<span class="exiFm">Exi</span> p) <span class=\"eqdef\">=</span> <span class="exiFm">Exi</span> (sub (n + 1) (inc_term s) p)<br />sub n s (<span class="uniFm">Uni</span> p) <span class=\"eqdef\">=</span> <span class="uniFm">Uni</span> (sub (n + 1) (inc_term s) p)</div>'));

    // Hide tabs default
    helpContent.children().hide();

    // 
    helpContent.append(dssContent);
    helpContent.append(sorContent);
    helpContent.append(sampleContent);
    //helpContent.append(copyrightContent);
    helpContent.append(welcomeContent);

    helpContent.children().hide();

    overlay.append(content);

    // Apply button events

    // Hide visible tabs on click
    $(".btnLeft, .btnMid, .btnRight").children().on("click",() => {
        $(".btnMid").children().removeClass("buttonMidHover");

        helpContent.children(":visible").hide();
    });

    $(".btnMid").children().on("click", e => $(e.currentTarget).addClass("buttonMidHover"));

    // Show corresponding tab on click
    welcomeButton.on("click",(e) => {
        welcomeContent.show();
    })

    //copyrightButton.on("click",() => {
    //    copyrightContent.show();
    //});

    folButton.on("click",() => {
        dssContent.show();
    });

    ndButton.on("click",() => {
        sorContent.show();
    });

    sampleButton.click(() => {
        sampleContent.show();
    });

    cancel.click(e => {
        $(".closeCenteredOverlay", overlay).trigger("click");
    });

    if (firstHelpClick) {
        // Welcome is default tab
        welcomeButton.click();
        firstHelpClick = false;
    } else {
        ndButton.click();
    }
};


/*
 * Term classes
 */

class Term {
    getInternalName(): string {
        return Term.getInternalName();
    }

    static getInternalName(): string {
        return "Term";
    }
}

class tmVar extends Term {
    nat: number;

    constructor(nat: number) {
        super();

        nat = +nat;

        if (nat < 0)
            throw new RangeError();

        this.nat = nat;
    }

    getInternalName(): string {
        return tmVar.getInternalName();
    }

    static getInternalName(): string {
        return "Var";
    }
}

class tmFun extends Term {
    id: string;
    tms: Term[];

    constructor(id: string, tms: Term[]) {
        super();

        this.id = id;
        this.tms = tms;
    }

    getInternalName(): string {
        return tmFun.getInternalName();
    }

    static getInternalName(): string {
        return "Fun";
    }
}

/* 
 * Formula classes
 */

class Formula {
    getInternalName(): string {
        return tmFun.getInternalName();
    }

    static getInternalName(): string {
        return "Formula";
    }
}

class FormulaOneArg extends Formula {
    fm: Formula;

    constructor(fm: Formula) {
        super();
        this.fm = fm;
    }
}

class FormulaTwoArg extends Formula {
    lhs: Formula;
    rhs: Formula;

    constructor(lhs: Formula, rhs: Formula) {
        super();
        this.lhs = lhs;
        this.rhs = rhs;
    }
}

class fmFalsity extends Formula {

    constructor() {
        super();
    }

    getInternalName(): string {
        return fmFalsity.getInternalName();
    }

    static getInternalName(): string {
        return "Falsity";
    }
};

class fmPre extends Formula {
    id: string;
    tms: Term[];

    constructor(id: string, tms: Term[]) {
        super();

        this.id = id;
        this.tms = tms;
    }

    getInternalName(): string {
        return fmPre.getInternalName();
    }

    static getInternalName(): string {
        return "Pre";
    }
}

class fmImp extends FormulaTwoArg {
    constructor(lhs: Formula, rhs: Formula) {
        super(lhs, rhs);
    }

    getInternalName(): string {
        return fmImp.getInternalName();
    }

    static getInternalName(): string {
        return "Imp";
    }
}

class fmDis extends FormulaTwoArg {
    constructor(lhs: Formula, rhs: Formula) {
        super(lhs, rhs);
    }

    getInternalName(): string {
        return fmDis.getInternalName();
    }

    static getInternalName(): string {
        return "Dis";
    }
}

class fmCon extends FormulaTwoArg {
    constructor(lhs: Formula, rhs: Formula) {
        super(lhs, rhs);
    }

    getInternalName(): string {
        return fmCon.getInternalName();
    }

    static getInternalName(): string {
        return "Con";
    }
}

class fmExi extends FormulaOneArg {
    constructor(fm: Formula) {
        super(fm);
    }

    getInternalName(): string {
        return fmExi.getInternalName();
    }

    static getInternalName(): string {
        return "Exi";
    }
}

class fmUni extends FormulaOneArg {
    constructor(fm: Formula) {
        super(fm);
    }

    getInternalName(): string {
        return fmUni.getInternalName();
    }

    static getInternalName(): string {
        return "Uni";
    }
}
interface InductiveInterface {
    evaluate(): void;
    isApplicable(): boolean;
    getPremisesAux(input: any[]): void;
}

class Inductive implements InductiveInterface {
    goal: Formula;
    premises: Inductive[] = [];
    assumptions: Formula[] = [];
    trueByAssumption: boolean;

    constructor(goal: Formula, assumptions: Formula[]) {
        this.goal = goal;
        this.assumptions = assumptions;

        this.checkGoal();
    }

    getPremises(...input): Inductive[] {
        if (typeof this.goal === undefined) {
            throw new Error("Must define a goal to infer premises");
        }

        if (!this.isApplicable())
            throw new Error("The rule is not applicable to this goal");

        this.premises = [];

        this.getPremisesAux(input);

        return this.premises;
    }

    checkGoal(): void {
        if (formulaContainsUnknowns(this.goal) || this.assumptions.some(v => { return formulaContainsUnknowns(v) }))
            return;

        for (var i in this.assumptions)
            if (equalFormulas(this.assumptions[i], this.goal)) {
                this.trueByAssumption = true;
                return;
            }
    }

    evaluate(): void {
        throw new Error("Method is abstract and must be overloaded");
    }

    getPremisesAux(input: any[]): void {
        throw new Error("Method is abstract and must be overloaded");
    }

    isApplicable(): boolean {
        throw new Error("Method is abstract and must be overloaded");
    }

    inferTruthValue(): void {
        this.evaluate();
    }

    inferTruthValueAux(n: number) {
        if (this.premises.length < n)
            throw new Error("Premises not sufficiently instantiated");

        var tv: boolean = true;

        for (var i = 0; i < n; i++) {
            if (this.premises[i].trueByAssumption === false) {
                tv = false;
                break;
            }
        }

        this.trueByAssumption = tv;
    }

    getInternalName(): string {
        return Inductive.getInternalName();
    }

    static getInternalName(): string {
        return "OK";
    }
}

class synBool extends Inductive implements InductiveInterface {

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synBool) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(1);
    }

    isApplicable() {
        return true;
    }

    static isApplicable(goal) {
        return true;
    }

    getPremisesAux(input: Formula[]) {
        var falsity: Formula = new fmFalsity();

        var assumptions: Formula[] = copyAssumptions(this).as;

        assumptions.push(new fmImp(this.goal, falsity));

        var inductive: Inductive = new Inductive(falsity, assumptions);
        this.premises.push(inductive);
    }

    getInternalName(): string {
        return synBool.getInternalName();
    }

    static getInternalName(): string {
        return "Boole";
    }
}

class synImpE extends Inductive implements InductiveInterface {

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synImpE) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(2);
    }

    isApplicable() {
        return true;
    }

    static isApplicable(goal) {
        return true;
    }

    getPremisesAux(input: Formula[]) {
        if (input.length < 1) {
            throw new Error("Expecting formula q");
        }

        var p: Formula = input[0];
        var fm1: Formula = new fmImp(p, this.goal);

        var assumptions: Formula[] = copyAssumptions(this).as;

        var inductive1: Inductive = new Inductive(fm1, assumptions);
        var inductive2: Inductive = new Inductive(p, assumptions);
        this.premises.push(inductive1);
        this.premises.push(inductive2);
    }

    getInternalName(): string {
        return synImpE.getInternalName();
    }

    static getInternalName(): string {
        return "ImpE";
    }
}

class synImpI extends Inductive implements InductiveInterface {

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synImpI) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(1);
    }

    isApplicable() {
        return synImpI.isApplicable(this.goal);
    }

    static isApplicable(goal) {
        return goal instanceof fmImp;
    }

    getPremisesAux(input: Formula[]) {
        var p: Formula = copyFormula((<fmImp> this.goal).lhs);
        var q: Formula = copyFormula((<fmImp> this.goal).rhs);

        var assumptions: Formula[] = copyAssumptions(this).as;
        assumptions.push(p);

        var inductive = new Inductive(q, assumptions);
        this.premises.push(inductive);
    }

    getInternalName(): string {
        return synImpI.getInternalName();
    }

    static getInternalName(): string {
        return "ImpI";
    }
}

class synDisE extends Inductive implements InductiveInterface {

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synDisE) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(3);
    }

    isApplicable() {
        return true;
    }

    static isApplicable(goal) {
        return true;
    }

    getPremisesAux(input: Formula[]) {
        if (input.length < 2) {
            throw new Error("Expecting formulas p and q");
        }

        var p: Formula = input[0];
        var q: Formula = input[1];

        var assumptions1: Formula[] = copyAssumptions(this).as;
        var assumptions2: Formula[] = copyAssumptions(this).as;
        var assumptions3: Formula[] = copyAssumptions(this).as;

        assumptions2.push(p);
        assumptions3.push(q);

        var r: Formula = this.goal;

        var fmPre1: Formula = new fmDis(p, q);

        var ind1: Inductive = new Inductive(fmPre1, assumptions1);
        var ind2: Inductive = new Inductive(r, assumptions2);
        var ind3: Inductive = new Inductive(r, assumptions3);

        this.premises.push(ind1, ind2, ind3);
    }

    getInternalName(): string {
        return synDisE.getInternalName();
    }

    static getInternalName(): string {
        return "DisE";
    }
}

class synDisI1 extends Inductive implements InductiveInterface {

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synDisI1) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(1);
    }

    isApplicable() {
        return synDisI1.isApplicable(this.goal);
    }

    static isApplicable(goal) {
        return goal instanceof fmDis;
    }

    getPremisesAux(input: Formula[]) {
        var p: Formula = (<fmCon> this.goal).lhs;
        var inductive: Inductive = new Inductive(p, copyAssumptions(this).as);
        this.premises.push(inductive);
    }

    getInternalName(): string {
        return synDisI1.getInternalName();
    }

    static getInternalName(): string {
        return "DisI1";
    }
}

class synDisI2 extends Inductive implements InductiveInterface {

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synDisI2) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(1);
    }

    isApplicable() {
        return synDisI2.isApplicable(this.goal);
    }

    static isApplicable(goal) {
        return goal instanceof fmDis;
    }

    getPremisesAux(input: Formula[]) {
        var q: Formula = (<fmCon >this.goal).rhs;
        var inductive: Inductive = new Inductive(q, copyAssumptions(this).as);
        this.premises.push(inductive);
    }

    getInternalName(): string {
        return synDisI2.getInternalName();
    }

    static getInternalName(): string {
        return "DisI2";
    }
}

class synConE1 extends Inductive implements InductiveInterface {

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synConE1) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(1);
    }

    isApplicable() {
        return true;
    }

    static isApplicable(goal) {
        return true;
    }

    getPremisesAux(input: Formula[]) {
        if (input.length < 1) {
            throw new Error("Expecting formula q");
        }

        var q: Formula = input[0];
        var ind: Inductive = new Inductive(new fmCon(this.goal, q), copyAssumptions(this).as);
        this.premises.push(ind);
    }

    getInternalName(): string {
        return synConE1.getInternalName();
    }

    static getInternalName(): string {
        return "ConE1";
    }
}

class synConE2 extends Inductive implements InductiveInterface {

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synConE2) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(1);
    }

    isApplicable() {
        return true;
    }

    static isApplicable(goal) {
        return true;
    }

    getPremisesAux(input: Formula[]) {
        if (input.length < 1) {
            throw new Error("Expecting formula q");
        }

        var p: Formula = input[0];
        var ind: Inductive = new Inductive(new fmCon(p, this.goal), copyAssumptions(this).as);
        this.premises.push(ind);
    }

    getInternalName(): string {
        return synConE2.getInternalName();
    }

    static getInternalName(): string {
        return "ConE2";
    }
}

class synConI extends Inductive implements InductiveInterface {

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synConI) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(2);
    }

    isApplicable() {
        return synConI.isApplicable(this.goal);
    }

    static isApplicable(goal) {
        return goal instanceof fmCon;;
    }

    getPremisesAux(input: Formula[]) {
        var p: Formula = (<fmCon> this.goal).lhs;
        var q: Formula = (<fmCon> this.goal).rhs;

        this.premises.push(new Inductive(p, copyAssumptions(this).as));
        this.premises.push(new Inductive(q, copyAssumptions(this).as));
    }

    getInternalName(): string {
        return synConI.getInternalName();
    }

    static getInternalName(): string {
        return "ConI";
    }
}

class synExiE extends Inductive implements InductiveInterface {
    c: Term;
    cIsNew: boolean;
    waitingForPCompletion: boolean;


    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synExiE) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(2);

        if (!this.cIsNew)
            this.trueByAssumption = false;
    }

    isApplicable() {
        return true;
    }

    static isApplicable(goal) {
        return true;
    }

    getPremisesAux(input: any[]) {
        if (input.length < 2) {
            throw new Error("Expecting formula p and term id c");
        }

        var p: Formula = input[0];
        var c: string = input[1];

        if (p === null) {
            this.waitingForPCompletion = true;
        }

        else {
            this.getNewsAndSub(c);
        }

        var ind1 = new Inductive(new fmExi(p), copyAssumptions(this).as);

        this.premises.push(ind1);
    }

    getNewsAndSub(cString: string) {
        if (this.premises[0] === undefined || !(this.premises[0].goal instanceof fmExi))
            throw new Error("Could not find formula p");

        var p: Formula = (<fmExi> this.premises[0].goal).fm;

        var newsFmList: Formula[] = copyAssumptions(this).as;
        newsFmList.push(copyFormula(p), copyFormula(this.goal));

        this.cIsNew = news(cString, newsFmList);
        this.c = new tmFun(cString, []);

        var ind2Assumptions: Formula[] = copyAssumptions(this).as;
        ind2Assumptions.push(sub(0, this.c, copyFormula(p)));

        var ind2 = new Inductive(this.goal, ind2Assumptions);
        this.premises.push(ind2);
    }

    getInternalName(): string {
        return synExiE.getInternalName();
    }

    static getInternalName(): string {
        return "ExiE";
    }
}

class synExiI extends Inductive implements InductiveInterface {

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synExiI) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(1);
    }

    isApplicable() {
        return synExiI.isApplicable(this.goal);
    }

    static isApplicable(goal) {
        return goal instanceof fmExi;
    }

    getPremisesAux(input: any[]) {
        if (input.length < 1) {
            throw new Error("Expecting term t");
        }

        var t: Term = input[0];

        var p: Formula = (<fmExi> this.goal).fm;
        var indFm: Formula = sub(0, t, copyFormula(p));

        this.premises.push(new Inductive(indFm, copyAssumptions(this).as));
    }

    getInternalName(): string {
        return synExiI.getInternalName();
    }

    static getInternalName(): string {
        return "ExiI";
    }
}

class synUniE extends Inductive implements InductiveInterface {
    waitingForTermSelection: boolean = true;

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synUniE) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(1);
    }

    isApplicable() {
        return synUniE.isApplicable(this.goal);
    }

    static isApplicable(goal) {
        return containsTerms(goal);
    }

    getPremisesAux(input: Term[]) {
        if (input.length < 1) {
            console.log(input);
            throw new Error("Expecting non-empty term list");
        }

        // Replace occurences of terms from input in p with "Var 0"
        // Build new formula as we traverse the formula tree
        // - The procedure is unique to this rule, and is therefore defined inline
        var fm: Formula = new fmUni(null);

        var stack: { x: any; y: any; k?: number }[] = [];
        stack.push({ x: this.goal, y: fm });

        while (stack.length > 0) {
            var e = stack.shift();

            var add;

            /* Determine which formula to add to y */
            if (e.x instanceof fmFalsity)
                add = new fmFalsity();

            else if (e.x instanceof fmCon) {
                add = new fmCon(null, null);

                /* Push LHS and RHS to stack */
                stack.push({ x: (<fmCon> e.x).lhs, y: add, k: 1 });
                stack.push({ x: (<fmCon> e.x).rhs, y: add, k: 2 });
            }

            else if (e.x instanceof fmDis) {
                add = new fmDis(null, null);

                /* Push LHS and RHS to stack */
                stack.push({ x: (<fmDis> e.x).lhs, y: add, k: 1 });
                stack.push({ x: (<fmDis> e.x).rhs, y: add, k: 2 });
            }

            else if (e.x instanceof fmImp) {
                add = new fmImp(null, null);

                /* Push LHS and RHS to stack */
                stack.push({ x: (<fmImp> e.x).lhs, y: add, k: 1 });
                stack.push({ x: (<fmImp> e.x).rhs, y: add, k: 2 });
            }

            else if (e.x instanceof fmExi) {
                add = new fmExi(null);

                /* Push p in fmExi(p) to stack */
                stack.push({ x: (<fmExi> e.x).fm, y: add });
            }

            else if (e.x instanceof fmUni) {
                add = new fmUni(null);

                /* Push p in fmUni(p) to stack */
                stack.push({ x: (<fmUni> e.x).fm, y: add });
            }

            else if (e.x instanceof fmPre) {
                add = new fmPre((<fmPre> e.x).id, []);

                /* Push replace terms in term list stack */
                (<fmPre> e.x).tms.forEach((t, i) => this.replaceTerm<fmPre>(t, i, input, add, stack));
            }

            else if (e.x instanceof tmFun) {
                add = e.y;

                /* Push replace terms in term list stack */
                (<tmFun> e.x).tms.forEach((t, i) => this.replaceTerm<tmFun>(t, i, input, add, stack));
            }

            // Replace correct field based on type of y
            if (e.y instanceof FormulaOneArg)
                (<FormulaOneArg> e.y).fm = add;

            else if (e.y instanceof FormulaTwoArg) {
                // Replace either LHS or RHS
                if (e.k == 1)
                    (<FormulaTwoArg> e.y).lhs = add;
                else
                    (<FormulaTwoArg> e.y).rhs = add;
            }

            else {
                // Do nothing
            }
        }

        // Create and push premise
        this.premises.push(new Inductive(fm, copyAssumptions(this).as));
    }

    replaceTerm<T extends { id: string; tms: Term[] }>(v: Term, i: number, input: Term[], add: T, stack: { x: any; y: any; k?: number }[]) {
        var replaced = input.some(w => {
            if (v === w) {
                add.tms[i] = new tmVar(0);
                return true;
            }
        });

        // Not replaced by Var 0 - add existing term to list
        // If term is a function, add it to stack
        if (!replaced) {
            var ins;

            if (v instanceof tmVar)
                ins = new tmVar((<tmVar> v).nat + 1);

            else if (v instanceof tmFun) {
                ins = new tmFun((<tmFun> v).id, []);

                stack.push({ x: v, y: ins });
            }

            add.tms[i] = ins;
        }
    }

    getInternalName(): string {
        return synUniE.getInternalName();
    }

    static getInternalName(): string {
        return "UniE";
    }
}

class synUniI extends Inductive implements InductiveInterface {
    c: Term;
    cIsNew: boolean;

    constructor(goal: Formula, assumptions: Formula[]) {
        super(goal, assumptions);

        if (!this.isApplicable()) {
            throw new Error("Could not apply rule (synUniI) to formula:\n" + getIsaSyntax(goal));
        }
    }

    evaluate() {
        this.inferTruthValueAux(1);

        this.trueByAssumption = this.trueByAssumption && this.cIsNew;
    }

    isApplicable() {
        return synUniI.isApplicable(this.goal);
    }

    static isApplicable(goal) {
        return goal instanceof fmUni;
    }

    getPremisesAux(input: string[]) {
        if (input.length < 1) {
            throw new Error("Expecting term id c");
        }

        var c: string = input[0];
        this.c = new tmFun(c, []);

        var p: Formula = (<fmUni> this.goal).fm;

        var newsFmList: Formula[] = copyAssumptions(this).as;
        newsFmList.push(copyFormula(p), copyFormula(this.goal));

        this.cIsNew = news(c, newsFmList);

        var l = copyFormula(p);

        var subResult = sub(0, this.c, l);

        this.premises.push(
            new Inductive(subResult, copyAssumptions(this).as));
    }

    getInternalName(): string {
        return synUniI.getInternalName();
    }

    static getInternalName(): string {
        return "UniI";
    }
}

/*
 * sub, subs, subl, subt
 */

function sub(n: number, s: Term, fm: Formula): Formula {
    var fmReturn: Formula;

    if (fm instanceof fmFalsity) {
        return new fmFalsity();
    }

    else if (fm instanceof fmPre) {
        var i = (<fmPre> fm).id;
        var tms = subl(n, s,(<fmPre> fm).tms);
        return new fmPre(i, tms);
    }

    else if (fm instanceof fmImp) {
        var lhs = sub(n, s,(<fmImp> fm).lhs);
        var rhs = sub(n, s,(<fmImp> fm).rhs);
        return new fmImp(lhs, rhs);
    }

    else if (fm instanceof fmDis) {
        var lhs = sub(n, s,(<fmDis> fm).lhs);
        var rhs = sub(n, s,(<fmDis> fm).rhs);
        return new fmDis(lhs, rhs);
    }

    else if (fm instanceof fmCon) {
        var lhs = sub(n, s,(<fmCon> fm).lhs);
        var rhs = sub(n, s,(<fmCon> fm).rhs);
        return new fmCon(lhs, rhs);
    }

    else if (fm instanceof fmExi) {
        return new fmExi(sub(n + 1, inct(s),(<fmExi> fm).fm));
    }

    else if (fm instanceof fmUni) {
        return new fmUni(sub(n + 1, inct(s),(<fmUni> fm).fm));
    }

    else {
        throw new Error("Unrecognized formula type");
    }
}

function subl(n: number, s: Term, ts: Term[]): Term[] {
    if (ts.length == 0)
        return [];
    else {
        var t = ts.shift();

        return [subt(n, s, t)].concat(subl(n, s, ts));

    }
}

function subt(n: number, s: Term, t: Term): Term {

    if (t instanceof tmVar) {
        var tv = <tmVar> t;

        if (tv.nat == n)
            return s;
        else if (tv.nat > n)
            return new tmVar(tv.nat - 1);
        else
            return new tmVar(tv.nat);
    }

    else if (t instanceof tmFun) {
        return new tmFun((<tmFun> t).id, subl(n, s,(<tmFun> t).tms));
    }

    else {
        throw new Error("Unrecognized term type");
    }
}

/*
 * newt, newl, new (named new1 due to reserved keyword), news
 */

function news(c: string, fmList: Formula[]): boolean {
    if (fmList.length == 0)
        return true;
    else {
        var p = fmList.shift();

        if (new1(c, p))
            return news(c, fmList);
        else
            return false;
    }
}

function new1(c: string, fm: Formula): boolean {
    if (fm instanceof fmFalsity)
        return true;

    else if (fm instanceof fmPre) {
        var l = (<fmPre> fm).tms;
        return newl(c, l);
    }

    else if (fm instanceof fmImp) {
        var p = (<fmImp> fm).lhs;
        var q = (<fmImp> fm).rhs;

        if (new1(c, p))
            return new1(c, q);
        else
            return false;
    }

    else if (fm instanceof fmDis) {
        var p = (<fmDis> fm).lhs;
        var q = (<fmDis> fm).rhs;

        if (new1(c, p))
            return new1(c, q);
        else
            return false;

    }

    else if (fm instanceof fmCon) {
        var p = (<fmCon> fm).lhs;
        var q = (<fmCon> fm).rhs;

        if (new1(c, p))
            return new1(c, q);
        else
            return false;

    }

    else if (fm instanceof fmExi)
        return new1(c,(<fmExi> fm).fm);

    else if (fm instanceof fmUni)
        return new1(c,(<fmUni> fm).fm);

    else
        throw new Error("Unrecognized formula type");
}

function newl(c: string, ts: Term[]): boolean {
    if (ts.length == 0)
        return true;
    else {
        var t = ts.shift();

        if (newt(c, t))
            return newl(c, ts);
        else
            return false;
    }
}

function newt(c: string, t: Term): boolean {
    if (t instanceof tmVar)
        return true;

    else if (t instanceof tmFun) {
        var i = (<tmFun> t).id;
        var l = (<tmFun> t).tms;

        if (i === c)
            return false;
        else
            return newl(c, l);
    }

    else
        throw new Error("Unrecognized term type");
}


/*
 * incl, inct
 */

function inct(t: Term): Term {
    if (t instanceof tmVar)
        return new tmVar((<tmVar> t).nat + 1);
    else if (t instanceof tmFun)
        return new tmFun((<tmFun> t).id, incl((<tmFun> t).tms));
    else if (t === null)
        return null;
}

function incl(ts: Term[]): Term[] {
    if (ts.length == 0)
        return [];
    else {
        var t = ts.shift();

        return [inct(t)].concat(incl(ts));
    }
}


//
// Return a string representation of the proof
//
function encodeProof(x: any): string {
    if (x === null || x === undefined)
        return ".";

    var s: string = "";

    if (x instanceof Inductive) {
        var ind: Inductive = x;

        s += x.getInternalName();

        s += "{" + encodeProof(ind.goal) + "}";

        s += "[";

        ind.assumptions.forEach((v, i) => {
            s += (i > 0 ? "," : "") + encodeProof(v);
        });

        s += "]";

        //
        // Handle inductive types with additional arguments
        //
        if (ind instanceof synExiE) {
            s += "{" + encodeProof((<synExiE> ind).c) + "," + ((<synExiE> ind).cIsNew ? "1" : "0") + "," + ((<synExiE> ind).waitingForPCompletion ? "1" : "0") + "}";
        }

        else if (ind instanceof synUniE) {
            s += "{" + ((<synUniE> ind).waitingForTermSelection ? "1" : "0") + "}";
        }

        else if (ind instanceof synUniI) {
            s += "{" + encodeProof((<synUniI> ind).c) + "," + ((<synUniI> ind).cIsNew ? "1" : "0") + "}";
        }

        if (ind.premises.length > 0) {

            s += ":";

            ind.premises.forEach(v => {
                s += "{" + encodeProof(v) + "}";
            });

        }
    }

    else if (x instanceof FormulaOneArg) {
        var foa: FormulaOneArg = <FormulaOneArg> x;

        s += foa.getInternalName();

        s += "{" + encodeProof(foa.fm) + "}";
    }

    else if (x instanceof FormulaTwoArg) {
        var fta: FormulaTwoArg = <FormulaTwoArg> x;

        s += fta.getInternalName();

        s += "{" + encodeProof(fta.lhs) + "}";
        s += "{" + encodeProof(fta.rhs) + "}";
    }

    else if (x instanceof fmPre) {
        var fmp: fmPre = <fmPre> x;

        s += fmp.getInternalName();

        s += "{";
        s += (fmp.id === null ? "." : fmp.id);
        s += "}";

        s += "{";

        if (fmp.tms === null)
            s += ".";
        else if (fmp.tms.length > 0) {
            fmp.tms.forEach(v => {
                s += encodeProof(v) + ",";
            });

            // Remove last comma
            s = s.substr(0, s.length - 1);
        }

        s += "}";
    }

    else if (x instanceof fmFalsity) {
        s += (<fmFalsity> x).getInternalName();
    }

    else if (x instanceof tmVar) {
        var tmv: tmVar = <tmVar> x;

        s += tmv.getInternalName() + "{" + tmv.nat.toString() + "}";
    }

    else if (x instanceof tmFun) {
        var tmf: tmFun = <tmFun> x;

        s += tmf.getInternalName();

        s += "{";
        s += (tmf.id === null ? "." : tmf.id);
        s += "}";
        s += "{";

        if (tmf.tms === null)
            s += ".";
        else if (tmf.tms.length > 0) {
            tmf.tms.forEach(v => {
                s += encodeProof(v) + ",";
            });

            // Remove last comma
            s = s.substr(0, s.length - 1);
        }

        s += "}";
    }

    else {
        console.log(x);
        throw new Error("Unexpected type of x");
    }

    return s;
}

//
// Build proof structure from string representation built by encoder
//
function decodeProof(x: string): Inductive[] {
    // Remove comment lines and then white spaces
    var y = x.replace(/^(\.|\#)[^\r\n]*/gm, "").split(/\s/);

    y = y.filter(s => { return s !== "" });

    var z: Inductive[] = [];

    var ok = true;

    y.forEach(p => {
        var dp = decodeProofAux(p);

        if (dp === null || dp === undefined)
            ok = false;

        z.push(dp);
    });

    if (!ok)
        return null;

    return z;
}

// Array of inductive classes
var inductiveClasses = [Inductive, synBool, synConE1, synConE2, synConI, synDisE, synDisI1, synDisI2, synExiE, synExiI, synImpE, synImpI, synUniE, synUniI];

// Array of formula classes
var formulaClasses = [fmCon, fmDis, fmExi, fmFalsity, fmImp, fmPre, fmUni];

// Array of term classes
var termClasses = [tmFun, tmVar];

//
// Build inductive regex
//
var indNameMatch = "";

inductiveClasses.forEach(v => {
    indNameMatch += v.getInternalName() + "|";
});

indNameMatch = indNameMatch.substr(0, indNameMatch.length - 1);

var indReg = new RegExp("^(" + indNameMatch + ")");

//
// Build formula regex
//

var fmNameMatch = "";

formulaClasses.forEach(v => {
    fmNameMatch += v.getInternalName() + "|";
});

fmNameMatch = fmNameMatch.substr(0, fmNameMatch.length - 1);

var fmReg = new RegExp("^(" + fmNameMatch + ")");

//
// Build term regex
//

var tmNameMatch = "";

termClasses.forEach(v => {
    tmNameMatch += v.getInternalName() + "|";
});

tmNameMatch = tmNameMatch.substr(0, tmNameMatch.length - 1);

var tmReg = new RegExp("^(" + tmNameMatch + ")");

//
// Decode proof (aux)
//

function decodeProofAux(x: string): any {
    //
    // Special unknown symbol
    //

    if (x === ".")
        return null;

    var m: string[];

    //
    // Match against inductive types
    //
    m = x.match(indReg);

    if (m !== null) {
        var ind: Inductive;

        var ex = extractArgs(x, true);

        // Extract arguments
        var indName: string = m[1];
        var indGoal: string = ex.args.shift();
        var indAssumptions: string = ex.assum;
        var indAdditionalArgs: string[] = (ex.args[0] !== undefined && ex.args[0].match(indReg) === null ? ex.args.shift() : "").split(",");
        var indPremises: string = (ex.args.length > 0) ? "" : undefined;

        while (ex.args.length > 0)
            indPremises += "{" + ex.args.shift() + "}";

        // Parse goal
        var goal: Formula = decodeProofAux(indGoal);

        // Make sure that goal was parsed correctly
        if (goal === undefined)
            return;

        // Parse assumptions
        var assumptions: Formula[] = [];

        if (indAssumptions !== undefined)
            ((e: string) => {
                var es: string[] = [];
                var b = 0, c = 0;

                for (var i = 0; i < e.length; i++) {
                    if (e[i] === "{")
                        b++;
                    else if (e[i] === "}")
                        b--;

                    if (e[i] === "," && b === 0) {
                        c++;
                    } else {
                        if (es[c] === undefined)
                            es[c] = "";
                        es[c] += e[i];
                    }
                }

                return es;
            }).call(null, indAssumptions).forEach(v => {
                var a: Formula = decodeProofAux(v);

                // Make sure that formula was parsed correctly
                if (a === undefined)
                    return;

                assumptions.push(a);
            });

        // Parse premises
        var premises: Inductive[] = [];

        if (indPremises !== undefined) {
            var premisesStrs = extractArgs(indPremises);

            premisesStrs.forEach(v => {
                var prem: Inductive = decodeProofAux(v);

                if (prem === undefined)
                    return;

                premises.push(prem);
            });
        }

        // Instantiate inductive object
        inductiveClasses.some(v => {
            if (indName === v.getInternalName()) {
                eval("ind = new v.prototype.constructor(goal, assumptions);");

                return true;
            }
        });

        ind.goal = goal;
        ind.assumptions = assumptions;
        ind.premises = premises;
        ind.checkGoal();

        //
        // Handle inductive types with additional arguments
        //
        if (ind instanceof synExiE && indAdditionalArgs.length >= 3) {
            var c = decodeProofAux(indAdditionalArgs[0]);
            var cIsNew = indAdditionalArgs[1] === "1";
            var waitingForPCompletion = indAdditionalArgs[2] === "1";

            if (c === undefined)
                return;

            (<synExiE> ind).c = c;
            (<synExiE> ind).cIsNew = cIsNew;
            (<synExiE> ind).waitingForPCompletion = waitingForPCompletion;
        }

        else if (ind instanceof synUniE && indAdditionalArgs.length >= 1) {
            var waitingForTermSelection = indAdditionalArgs[0] === "1";

            (<synUniE> ind).waitingForTermSelection = waitingForTermSelection;
        }

        else if (ind instanceof synUniI && indAdditionalArgs.length >= 2) {
            var c = decodeProofAux(indAdditionalArgs[0]);
            var cIsNew = indAdditionalArgs[1] === "1";

            if (c === undefined)
                return;

            (<synUniI> ind).c = c;
            (<synUniI> ind).cIsNew = cIsNew;
        }

        return ind;
    }

    //
    // Match against formula types
    //
    m = x.match(fmReg);

    if (m !== null) {
        // Construct new object generically
        var fm: Formula;

        var fmName = m[1];

        formulaClasses.some(v => {
            if (fmName === (<typeof Formula> v).getInternalName()) {

                eval("fm = new v.prototype.constructor(null, null);");

                return true;
            }
        });

        // Make sure that formula was parsed correctly
        if (fm === undefined)
            return;

        // Extract arguments
        var args: string[] = extractArgs(x);

        //
        // Choose instantiation procedure based on formula type
        //

        if (fm instanceof FormulaOneArg) {
            var fmInner: Formula = decodeProofAux(args[0]);

            // Make sure that formula was parsed correctly
            if (fmInner === undefined)
                return;

            (<FormulaOneArg> fm).fm = fmInner;
        }

        else if (fm instanceof FormulaTwoArg) {
            var fmInnerLHS: Formula = decodeProofAux(args[0]);
            var fmInnerRHS: Formula = decodeProofAux(args[1]);

            // Make sure that formulas were parsed correctly
            if (fmInnerLHS === undefined || fmInnerRHS === undefined)
                return;

            (<FormulaTwoArg> fm).lhs = fmInnerLHS;
            (<FormulaTwoArg> fm).rhs = fmInnerRHS;

        }

        else if (fm instanceof fmPre) {

            if (args[0] !== ".")
                (<fmPre> fm).id = args[0];

            if (args[1] !== ".") {
                (<fmPre> fm).tms = [];

                if (args[1] !== undefined) {
                    args[1].split(",").forEach(v => {
                        var tm: Term = decodeProofAux(v);

                        // Make sure that term was parsed correctly
                        if (tm === undefined)
                            return;

                        (<fmPre> fm).tms.push(tm);
                    });
                }
            }
        }

        else if (fm instanceof fmFalsity) {
            // Do nothing
        }

        else {
            console.log(fm);
            throw new Error("Unexpected type of fm");
        }

        return fm;
    }

    //
    // Match against formula types
    //
    m = x.match(tmReg);

    if (m !== null) {
        // Construct new object generically
        var tm: Term;

        var tmName = m[1];

        termClasses.some(v => {
            if (tmName === v.getInternalName()) {

                eval("tm = new v.prototype.constructor(null, null);");

                return true;
            }
        });

        // Make sure that formula was parsed correctly
        if (tm === undefined)
            return;

        // Extract arguments
        var args: string[] = extractArgs(x);

        if (tm instanceof tmVar) {
            (<tmVar> tm).nat = +args[0];
        }

        else if (tm instanceof tmFun) {
            if (args[0] !== ".")
                (<tmFun> tm).id = args[0];

            if (args[1] !== ".") {
                (<tmFun> tm).tms = [];

                if (args[1] !== undefined) {
                    args[1].split(",").forEach(v => {
                        var tmArg: Term = decodeProofAux(v);

                        // Make sure that term was parsed correctly
                        if (tmArg === undefined)
                            return;

                        (<tmFun> tm).tms.push(tmArg);
                    });
                }
            }
        }

        else {
            console.log(tm);
            throw new Error("Unexpected type of tm");
        }

        return tm;
    }

    else {
        return;
    }
}

//
// Helper function to deal with problem of well-balanced curly braces / brackets
//
function extractArgs(x: string, isInd: boolean = false): any {
    var args: string[] = [""];
    var c = 0, b = 0;

    var assumStr: string = "";
    var d = 0;

    for (var i = 0; i < x.length; i++) {

        if (x[i] === "{") {
            b++;

            if (b == 1 && d == 0)
                continue;
        }

        else if (x[i] === "}") {
            b--;

            if (b == 0 && d == 0) {

                c++;

                if (i !== x.length - 1)
                    args[c] = "";

                continue;
            }
        }

        else if (x[i] === "[" && b === 0) {
            d++;

            if (d == 1)
                continue;
        }

        else if (x[i] === "]" && b === 0) {
            d--;
        }

        if (isInd && d > 0) {
            assumStr += x[i];
        }

        else if (b > 0 && d == 0) {
            args[c] += x[i];
        }
    }

    return !isInd ? args : { args: args, assum: assumStr };
}

function isValidProofCode(x: string) {
    var dp = decodeProof(x);

    return dp !== null && dp !== undefined;
}

// Deep copy of a list of assumptions
function copyAssumptions(x: Inductive): { as: Formula[]; n: number } {
    var assumptions: Formula[] = [];

    var numRefs = 0;

    x.assumptions.forEach(function (v) {
        if (v === null)
            numRefs++;

        assumptions.push(copyFormula(v));
    });

    return { as: assumptions, n: numRefs };
}

// Deep copy of formula
function copyFormula(x: Formula, refs: any[] = null): Formula {
    if (x === null)
        return null;

    var y: Formula;

    var fm: Formula, lhs: Formula, rhs: Formula;

    if (x instanceof FormulaOneArg) {
        fm = copyFormula((<FormulaOneArg> x).fm, refs);

        var r: Formula;

        if (x instanceof fmExi)
            r = new fmExi(fm);

        else if (x instanceof fmUni)
            r = new fmUni(fm);

        if (refs !== null && fm === null)
            refs.push(r);

        return r;
    }

    else if (x instanceof FormulaTwoArg) {
        lhs = copyFormula((<FormulaTwoArg> x).lhs, refs);
        rhs = copyFormula((<FormulaTwoArg> x).rhs, refs);

        var r: Formula;

        if (x instanceof fmCon)
            r = new fmCon(lhs, rhs);

        else if (x instanceof fmDis)
            r = new fmDis(lhs, rhs);

        else if (x instanceof fmImp)
            r = new fmImp(lhs, rhs);

        if (refs !== null && lhs === null)
            refs.push(r);
        if (refs !== null && rhs === null)
            refs.push(r);

        return r;
    }

    else if (x instanceof fmFalsity)
        return new fmFalsity();

    else if (x instanceof fmPre) {
        var tms: Term[] = [];

        if ((<fmPre> x).tms === null)
            tms = null;
        else
            (<fmPre> x).tms.forEach(v => {
                tms.push(copyTerm(v, refs));
            });

        var r: Formula = new fmPre((<fmPre> x).id, tms);

        if (refs !== null && x.id === null)
            refs.push(r);
        if (refs !== null && x.tms === null)
            refs.push(r);

        return r;
    }
};

// Deep copy of term
function copyTerm(x: Term, refs: any[] = null): Term {
    if (x === null)
        return null;

    if (x instanceof tmVar)
        return new tmVar((<tmVar> x).nat);
    else if (x instanceof tmFun) {
        var tms: Term[] = [];

        if ((<tmFun> x).tms === null)
            tms = null;
        else
            (<tmFun> x).tms.forEach(v=> {
                tms.push(copyTerm(v, refs));
            });

        var t = new tmFun((<tmFun> x).id, tms);

        if (refs !== null && x.id === null)
            refs.push(t);
        if (refs !== null && x.tms === null)
            refs.push(t);

        return t;
    }
}

// Check if two formulas are equal
function equalFormulas(fm1: any, fm2: any): boolean {
    if (fm1 === null || fm2 === null) {
        if (fm1 === null && fm2 === null)
            return true;
        else
            return false;
    }

    if (fm1.constructor !== fm2.constructor)
        return false;

    if (fm1 instanceof fmCon) {
        var fmC1: fmCon = <fmCon> fm1;
        var fmC2: fmCon = <fmCon> fm2;

        return equalFormulas(fmC1.lhs, fmC2.lhs)
            && equalFormulas(fmC1.rhs, fmC2.rhs);
    }

    else if (fm1 instanceof fmDis) {
        var fmD1: fmDis = <fmDis> fm1;
        var fmD2: fmDis = <fmDis> fm2;

        return equalFormulas(fmD1.lhs, fmD2.lhs)
            && equalFormulas(fmD1.rhs, fmD2.rhs);
    }

    else if (fm1 instanceof fmImp) {
        var fmI1: fmImp = <fmImp> fm1;
        var fmI2: fmImp = <fmImp> fm2;

        return equalFormulas(fmI1.lhs, fmI2.lhs)
            && equalFormulas(fmI1.rhs, fmI2.rhs);
    }

    else if (fm1 instanceof fmExi) {
        var fmE1: fmExi = <fmExi> fm1;
        var fmE2: fmExi = <fmExi> fm2;

        return equalFormulas(fmE1.fm, fmE2.fm);
    }

    else if (fm1 instanceof fmUni) {
        var fmU1: fmUni = <fmUni> fm1;
        var fmU2: fmUni = <fmUni> fm2

        return equalFormulas(fmU1.fm, fmU2.fm);
    }

    else if (fm1 instanceof fmFalsity) {
        return true;
    }

    else if (fm1 instanceof fmPre) {
        var fmP1: fmPre = <fmPre> fm1;
        var fmP2: fmPre = <fmPre> fm2;

        if (fmP1.id === fmP2.id && fmP1.tms === null && fmP2.tms === null)
            return true;

        if (fmP1.id != fmP2.id || (fmP1.tms === null || fmP2.tms === null) || fmP1.tms.length != fmP2.tms.length)
            return false;

        fmP1.tms.forEach(function (v, i) {
            if (!equalFormulas(v, fmP2.tms[i]))
                return false;
        });

        return true;
    }

    else if (fm1 instanceof tmVar) {
        var tmN1: tmVar = <tmVar> fm1;
        var tmN2: tmVar = <tmVar> fm2;

        return tmN1.nat == tmN2.nat;
    }

    else if (fm1 instanceof tmFun) {
        var tmF1: tmFun = <tmFun> fm1;
        var tmF2: tmFun = <tmFun> fm2;

        if (fmP1.id === fmP2.id && fmP1.tms === null && fmP2.tms === null)
            return true;

        if (fmP1.id != fmP2.id || (fmP1.tms === null || fmP2.tms === null) || fmP1.tms.length != fmP2.tms.length)
            return false;

        tmF1.tms.forEach(function (v, i) {
            if (!equalFormulas(v, tmF2.tms[i]))
                return false;
        });

        return true;
    }

    else
        throw new Error("Failed to recognize formula object of type " + (typeof fm1));


    return true;
}

// Recursively find inductive types without unknowns and add them to a parsed array
function findUndefInductivesWithoutUnknowns(rs: { parent: Inductive; premiseIndex: number }[], s: Inductive, p: Inductive, n: number, k: number): number {

    if (!formulaContainsUnknowns(s.goal) && !s.assumptions.some(v=> {
        return formulaContainsUnknowns(v);
    })) {
        rs[n] = { parent: p, premiseIndex: k, self: s };
    }

    n++;

    s.premises.forEach((v, i) => {
        n = findUndefInductivesWithoutUnknowns(rs, v, s, n, i);
    });

    return n;
}

// Determines if a formula contains any unknowns (recursive)
function formulaContainsUnknowns(x: any): boolean {
    var r = false;

    if (x === null)
        return true;
    else if (x instanceof fmFalsity)
        return false;
    else if (x instanceof FormulaOneArg)
        return formulaContainsUnknowns((<FormulaOneArg> x).fm);
    else if (x instanceof FormulaTwoArg)
        return formulaContainsUnknowns((<FormulaTwoArg> x).lhs)
            || formulaContainsUnknowns((<FormulaTwoArg> x).rhs);

    else if (x instanceof fmPre) {
        return (<fmPre> x).id === null
            || (<fmPre> x).tms === null
            || (<fmPre> x).tms.some(v=> {
                if (formulaContainsUnknowns(v))
                    return true;
            });
    }

    else if (x instanceof tmVar)
        return (<tmVar> x).nat === null;
    else if (x instanceof tmFun) {
        return (<tmFun> x).id === null
            || (<tmFun> x).tms === null
            || (<tmFun> x).tms.some(v=> {
                if (formulaContainsUnknowns(v))
                    return true;
            });
    }

    else {
        console.log(x);
        throw new Error("Unexpected type received by function.");
    }
}

// Helper function to push indices of an array
function pushIndices(arr: any[], start: number, pushN: number) {
    if (start < 0 || pushN < 1)
        return;

    for (var i = arr.length - 1; i >= start; i--) {
        arr[i + pushN] = arr[i];
    }
}

// Helper function to set links between unknowns
function setLinkedUnks(linkedUnks: Unknown[][]) {
    linkedUnks.forEach((v, i) => {
        if (v.length == 2) {
            v[0].linkedTo = [v[1]];
            v[1].linkedTo = [v[0]];
        }
    });
}

// Helper function to generate constants and keep track of the counter
function getNewConstant(): string {
    var s = "c";

    for (var i = 0; i <= currentState.gc; i++)
        s += "*";

    currentState.gc++;

    return s;
}

// Determines if a formula contains terms
function containsTerms(x: any): boolean {
    if (x instanceof Term)
        return true;
    else if (x instanceof FormulaOneArg)
        return containsTerms((<FormulaOneArg> x).fm);
    else if (x instanceof FormulaTwoArg)
        return containsTerms((<FormulaTwoArg> x).lhs) || containsTerms((<FormulaTwoArg> x).rhs);
    else if (x instanceof fmPre)
        return (<fmPre> x).tms.length > 0;
    else
        return false;
}

// Return terms occuring in a formula
function getTerms(x: any): Term[] {
    // Formula cases - nothing to add yet - recurse further
    if (x instanceof FormulaOneArg)
        return getTerms((<FormulaOneArg> x).fm);

    else if (x instanceof FormulaTwoArg)
        return getTerms((<FormulaTwoArg> x).lhs).concat(getTerms((<FormulaTwoArg> x).rhs));

    else if (x instanceof fmPre) {
        var ts = [];

        //ts.push.apply(ts, (<fmPre> x).tms);

        (<fmPre> x).tms.forEach(e => { ts.push.apply(ts, getTerms(e)) });

        return ts;
    }

    else if (x instanceof tmFun) {
        var ts = [];

        ts.push(<tmFun> x);

        (<tmFun> x).tms.forEach(e => { ts.push.apply(ts, getTerms(e)) });

        return ts;
    }

    else if (x instanceof tmVar)
        return [<tmVar> x];

    else {
        console.log(x);
        throw new Error("Expected formula or term object.");
    }
}

// Helper function to return an identifier for the quantified variable
var variableSymbols = ["x", "y", "z", "u", "v", "w"];

function getQuantifiedVariable(n: number): string {
    if (variableSymbols.length <= n) {
        var s = variableSymbols[variableSymbols.length - 1];

        for (var i = 0; i < n - variableSymbols.length + 1; i++)
            s += "#";

        return s;
    }
    else return variableSymbols[n];
}

// Returns the precedence of a given formula
function precedence(x: Formula): number {
    if (x instanceof fmFalsity || x instanceof fmPre)
        return 1;

    else if (x instanceof fmCon)
        return 2;

    else if (x instanceof fmDis)
        return 3;

    else if (x instanceof fmImp)
        return 4;

    else if (x instanceof fmExi || x instanceof fmUni)
        return 5;

    else
        return 0;
}

// Reconstructs lists of unknowns from parsed proof structure
function reconstructUnknownsFromProof(x: any, l: Unknown[] = []): Unknown[] {
    if (x instanceof Inductive) {
        //
        // Now considering type: Inductive
        //

        var p: Formula, q: Formula;

        if (x instanceof synImpE) {
            //
            // Special case: ImpE
            //

            p = x.premises[1].goal;
            var impPQ: fmImp = x.premises[0].goal;

            if (!equalFormulas(p, impPQ.lhs)) {
                throw new Error("Linked formula p appears different despite being linked");
            }

            if (p === null) {
                var unkQ1: Unknown = { x: x.premises[1], inFm: 1 };
                var unkQ2: Unknown = { x: impPQ, inFm: 1 };

                unkQ1.linkedTo = [unkQ2];
                unkQ2.linkedTo = [unkQ1];

                l.push(unkQ1, unkQ2);
            } else {
                var lp1 = reconstructUnknownsFromProof(p, []);
                var lp2 = reconstructUnknownsFromProof(impPQ.lhs, []);

                for (var i = 0; i < lp1.length; i++) {
                    lp1[i].linkedTo = [lp2[i]];
                    lp2[i].linkedTo = [lp1[i]];
                }

                l = l.concat(lp1.concat(lp2));
            }
        } else if (x instanceof synDisE) {
            //
            // Special case: DisE
            //

            var disPQ: fmDis = x.premises[0].goal;
            p = disPQ.lhs;
            q = disPQ.rhs;

            var assumP: Formula[] = x.premises[1].assumptions;
            var assumQ: Formula[] = x.premises[2].assumptions

            var qIndex = 0,
                pIndex = 0;

            if (!assumQ.some((v, i) => { if (equalFormulas(q, v)) { qIndex = i; return true } })
                || !assumP.some((v, i) => { if (equalFormulas(p, v)) { pIndex = i; return true } })) {
                throw new Error("Linked formulas p and/or q are different despite being linked");
            }

            var lp1: Unknown[] = [], lp2: Unknown[] = [],
                lq1: Unknown[] = [], lq2: Unknown[] = [];

            var unkP1: Unknown, unkP2: Unknown,
                unkQ1: Unknown, unkQ2: Unknown;

            if (p === null) {
                unkP1 = { x: disPQ, inFm: 1 };
                unkP2 = { x: x.premises[1], inAssumption: pIndex };
                unkP1.linkedTo = [unkP2];
                unkP2.linkedTo = [unkP1];

                lp1.push(unkP1);
                lp2.push(unkP2);
            } else {
                lp1 = reconstructUnknownsFromProof(p, []);
                lp2 = reconstructUnknownsFromProof(assumP[pIndex], []);

                for (var i = 0; i < lp1.length; i++) {
                    lp1[i].linkedTo = [lp2[i]];
                    lp2[i].linkedTo = [lp1[i]];
                }
            }

            if (q === null) {
                unkQ1 = { x: disPQ, inFm: 2 };
                unkQ2 = { x: x.premises[2], inAssumption: qIndex };
                unkQ1.linkedTo = [unkQ2];
                unkQ2.linkedTo = [unkQ1];

                lq1.push(unkQ1);
                lq2.push(unkQ2);
            } else {
                lq1 = reconstructUnknownsFromProof(q, []);
                lq2 = reconstructUnknownsFromProof(assumQ[qIndex], []);

                for (var i = 0; i < lq1.length; i++) {
                    lq1[i].linkedTo = [lq2[i]];
                    lq2[i].linkedTo = [lq1[i]];
                }
            }

            l = l.concat(lp1.concat(lq1.concat(lp2.concat(lq2))));

        } else {
            //
            // General case
            //

            if ((<Inductive> x).goal === null)
                // Unknown is goal
                l.push({ x: x, inFm: 1 });
            else
                reconstructUnknownsFromProof((<Inductive> x).goal, l);

            // Unknowns in assumptions
            (<Inductive> x).assumptions.forEach((v, i) => {
                if (v === null) {
                    l.push({ x: x, inAssumption: i });
                } else {
                    l = reconstructUnknownsFromProof(v, l)
                }
            });

            // Unknowns in premises
            (<Inductive> x).premises.forEach(v => {
                l = reconstructUnknownsFromProof(v, l)
            });
        }
    }

    else if (x instanceof Formula) {
        //
        // Now considering type: Formula
        //
        if (x instanceof FormulaOneArg) {
            //
            // Now considering type: One argument formula
            //

            if ((<FormulaOneArg> x).fm === null) {
                l.push({ x: x, inFm: 1 });
            } else {
                l = reconstructUnknownsFromProof((<FormulaOneArg> x).fm, l);
            }
        }

        else if (x instanceof FormulaTwoArg) {
            //
            // Now considering type: Two argument formula
            //

            if ((<FormulaTwoArg> x).lhs === null) {
                l.push({ x: x, inFm: 1 });
            } else {
                l = reconstructUnknownsFromProof((<FormulaTwoArg> x).lhs, l);
            }

            if ((<FormulaTwoArg> x).rhs === null) {
                l.push({ x: x, inFm: 2 });
            } else {
                l = reconstructUnknownsFromProof((<FormulaTwoArg> x).rhs, l);
            }
        }

        else if (x instanceof fmPre) {
            //
            // Now considering type: Predicate
            //

            if ((<fmPre> x).id === null) {
                l.push({ x: x, inFm: 1 });
            }

            if ((<fmPre> x).tms === null) {
                l.push({ x: x, inFm: 2 });
            }

            else {
                (<fmPre> x).tms.forEach((v, i) => {
                    if (v === null) {
                        l.push({ x: x, inTm: i });
                    } else {
                        l = reconstructUnknownsFromProof(v, l);
                    }
                });
            }
        }
    }

    else if (x instanceof Term) {
        //
        // Now considering type: Term
        //

        if (x instanceof tmFun) {
            //
            // Now considering type: Function
            //

            if ((<tmFun> x).id === null) {
                l.push({ x: x, inFm: 1 });
            }

            if ((<tmFun> x).tms === null) {
                l.push({ x: x, inFm: 2 });
            }

            else {
                (<tmFun> x).tms.forEach((v, i) => {
                    if (v === null) {
                        l.push({ x: x, inTm: i });
                    } else {
                        l = reconstructUnknownsFromProof(v, l);
                    }
                });
            }
        }

        else if (x instanceof tmVar) {
            //
            // Now considering type: Variable
            //

            if ((<tmVar> x).nat === null)
                l.push({ x: x, inFm: 1 });
        }
    }

    return l;
};

// Gets the Isabelle (code) syntax for a proof
function getIsaSyntax(x: any, isTerm: boolean = false): string {

    var fmIsa: string;

    if (x instanceof fmCon) {
        var fmC: fmCon = <fmCon> x;
        fmIsa = '<div class="leftParantheses">(</div><div class="con">Con</div><div class="arg">' + getIsaSyntax(fmC.lhs) + '</div><div class="arg lastArg">' + getIsaSyntax(fmC.rhs) + '</div><div class="rightParantheses">)</div>';
    }

    else if (x instanceof fmDis) {
        var fmD: fmDis = <fmDis> x;
        fmIsa = '<div class="leftParantheses">(</div><div class="dis">Dis</div><div class="arg">' + getIsaSyntax(fmD.lhs) + '</div><div class="arg lastArg">' + getIsaSyntax(fmD.rhs) + '</div><div class="rightParantheses">)</div>';
    }

    else if (x instanceof fmImp) {
        var fmI: fmImp = <fmImp> x;
        fmIsa = '<div class="leftParantheses">(</div><div class="imp">Imp</div><div class="arg">' + getIsaSyntax(fmI.lhs) + '</div><div class="arg lastArg">' + getIsaSyntax(fmI.rhs) + '</div><div class="rightParantheses">)</div>';
    }

    else if (x instanceof fmExi) {
        var fmE: fmExi = <fmExi> x;
        fmIsa = '<div class="exi">Exi</div><div class="arg lastArg">' + getIsaSyntax(fmE.fm) + '</div>';
    }

    else if (x instanceof fmUni) {
        var fmU: fmUni = <fmUni> x;
        fmIsa = '<div class="uni">Uni</div><div class="arg lastArg">' + getIsaSyntax(fmU.fm) + '</div>';
    }

    else if (x instanceof fmFalsity) {
        var fmF: fmFalsity = <fmFalsity> x;
        fmIsa = '<div class="falsity">Falsity</div>';
    }

    else if (x instanceof fmPre) {
        var fmP: fmPre = <fmPre> x;
        fmIsa = '<div class="pre">Pre</div><div class="arg id">' + (fmP.id === null ? '@id' : '"' + fmP.id + '"') + "</div>";

        fmIsa += '<div class="arg lastArg">';

        if (fmP.tms === null) {
            fmIsa += '@tms';
        } else {
            var elems: string[] = [];

            fmP.tms.forEach(function (v) {
                elems.push(getIsaSyntax(v, true));
            });

            fmIsa += '<div class="leftBracket">[</div>' + elems.join('<div class="comma">,</div>') + '<div class="rightBracket">]</div>';
        }

        fmIsa += "</div>";

        fmIsa = '<div class="leftParantheses">(</div>' + fmIsa + '<div class="rightParantheses">)</div>';
    }

    else if (x instanceof tmVar) {
        var tmN: tmVar = <tmVar> x;
        fmIsa = '<div class="var">Var</div><div class="arg lastArg">' + (tmN.nat === undefined ? '@id' : tmN.nat.toString()) + "</div>";
    }

    else if (x instanceof tmFun) {
        var tmF: tmFun = <tmFun> x;
        fmIsa = '<div class="fun">Fun</div><div class="arg id">' + (tmF.id === null ? '@id' : '"' + tmF.id + '"') + "</div>";

        fmIsa += '<div class="arg lastArg">';

        if (tmF.tms === null) {
            fmIsa += '@tms';
        } else {
            var elems: string[] = [];

            tmF.tms.forEach(function (v) {
                elems.push(getIsaSyntax(v, true));
            });

            fmIsa += '<div class="leftBracket">[</div>' + elems.join('<div class="comma">,</div>') + '<div class="rightBracket">]</div>';
        }

        fmIsa += "</div>";

        fmIsa = '<div class="leftParantheses">(</div>' + fmIsa + '<div class="rightParantheses">)</div>';
    }

    else
        fmIsa = isTerm ? '@tm' : '@fm';

    return fmIsa;
}

// Gets the formal syntax for a proof
function getFormalSyntax(x: any, nq: number, y: any): string {
    // nq: number of nested quantifiers

    var fmFormal: string;

    if (x instanceof fmCon) {
        var fmC: fmCon = <fmCon> x;
        fmFormal = '<div class="arg">' + getFormalSyntax(fmC.lhs, nq, fmC) + "</div>";

        if (fmC.lhs instanceof fmCon)
            fmFormal = '<div class="leftParantheses">(</div>' + fmFormal + '<div class="rightParantheses">)</div>';

        fmFormal += '<div class="con">@con</div><div class="arg lastArg">' + getFormalSyntax(fmC.rhs, nq, fmC) + "</div>";
    }

    else if (x instanceof fmDis) {
        var fmD: fmDis = <fmDis> x;
        fmFormal = '<div class="arg">' + getFormalSyntax(fmD.lhs, nq, fmD) + "</div>";

        if (fmD.lhs instanceof fmDis)
            fmFormal = '<div class="leftParantheses">(</div>' + fmFormal + '<div class="rightParantheses">)</div>';

        fmFormal += '<div class="dis">@dis</div><div class="arg">' + getFormalSyntax(fmD.rhs, nq, fmD) + '</div>';
    }

    else if (x instanceof fmImp) {
        var fmI: fmImp = <fmImp> x;
        fmFormal = '<div class="arg">' + getFormalSyntax(fmI.lhs, nq, fmI) + "</div>";

        if (fmI.lhs instanceof fmImp)
            fmFormal = '<div class="leftParantheses">(</div>' + fmFormal + '<div class="rightParantheses">)</div>';

        fmFormal += '<div class="imp">@imp</div><div class="arg">' + getFormalSyntax(fmI.rhs, nq, fmI) + "</div>";
    }

    else if (x instanceof fmExi) {
        var fmE: fmExi = <fmExi> x;

        fmFormal = '<div class="exi">@exi{' + getQuantifiedVariable(nq) + '}</div><div class="arg">' + getFormalSyntax(fmE.fm, nq + 1, fmE) + '</div>';

        if (!(y instanceof fmExi) && !(y instanceof fmUni) && precedence(x) < precedence(y))
            fmFormal = '<div class="leftParantheses">(</div>' + fmFormal + '<div class="rightParantheses">)</div>';
    }

    else if (x instanceof fmUni) {
        var fmU: fmUni = <fmUni> x;
        fmFormal = '<div class="uni">@uni{' + getQuantifiedVariable(nq) + '}</div><div class="arg">' + getFormalSyntax(fmU.fm, nq + 1, fmU) + '</div>';

        if (!(y instanceof fmExi) && !(y instanceof fmUni) && precedence(x) < precedence(y))
            fmFormal = '<div class="leftParantheses">(</div>' + fmFormal + '<div class="rightParantheses">)</div>';
    }

    else if (x instanceof fmFalsity) {
        var fmF: fmFalsity = <fmFalsity> x;
        fmFormal = '<div class="falsity">@false</div>';
    }

    else if (x instanceof fmPre) {
        var fmP: fmPre = <fmPre> x;
        fmFormal = '<div class="pre"><div class="id">';
        fmFormal += fmP.id === null ? '@id' : fmP.id;
        fmFormal += '</div>';

        if (fmP.tms === null) {
            fmFormal += '<div class="leftParantheses">(</div>@tms<div class="rightParantheses">)</div>';
        } else {
            var elems: string[] = [];

            fmP.tms.forEach(function (v) {
                elems.push(getFormalSyntax(v, nq, fmP));
            });

            if (elems.length > 0)
                fmFormal += '<div class="leftParantheses">(</div>' + elems.join('<div class="comma">,</div>') + '<div class="rightParantheses">)</div>';
        }

        fmFormal += '</div>';
    }

    else if (x instanceof tmVar) {
        var tmN: tmVar = <tmVar> x;
        fmFormal = '<div class="var">' + (tmN.nat === null ? '@id' : getQuantifiedVariable(tmN.nat)) + '</div>';
    }

    else if (x instanceof tmFun) {
        var tmF: tmFun = <tmFun> x;
        fmFormal = '<div class="fun"><div class="id">' + (tmF.id === null ? '@id' : tmF.id) + '</div>';

        if (tmF.tms === null) {
            fmFormal += '(@tms<div class="rightParantheses">)</div>';
        } else {
            var elems: string[] = [];

            tmF.tms.forEach(function (v) {
                elems.push(getFormalSyntax(v, nq, tmF));
            });

            if (elems.length > 0)
                fmFormal += '<div class="leftParantheses">(</div>' + elems.join('<div class="comma">,</div>') + '<div class="rightParantheses">)</div>';
        }

        fmFormal += '</div>';
    }

    else
        fmFormal = '@fm';

    if (y !== undefined && y !== null)
        if (precedence(x) > precedence(y))
            fmFormal = '<div class="leftParantheses">(</div>' + fmFormal + '<div class="rightParantheses">)</div>';

    return fmFormal;
}

// Returns the corresponding name of a rule
function getRuleName(x: Inductive): string {
    if (x instanceof synBool)
        return "Boole";
    else if (x instanceof synConE1)
        return "Con_E1";
    else if (x instanceof synConE2)
        return "Con_E2";
    else if (x instanceof synConI)
        return "Con_I";
    else if (x instanceof synDisE)
        return "Dis_E";
    else if (x instanceof synDisI1)
        return "Dis_I1";
    else if (x instanceof synDisI2)
        return "Dis_I2";
    else if (x instanceof synExiI)
        return "Exi_I";
    else if (x instanceof synExiE)
        return "Exi_E" + (
            (<synExiE> x).waitingForPCompletion ? ":incomplete" : ""
            );
    else if (x instanceof synImpE)
        return "Imp_E";
    else if (x instanceof synImpI)
        return "Imp_I";
    else if (x instanceof synUniE)
        return "Uni_E" + (
            (<synUniE> x).waitingForTermSelection ? ":incomplete" : ""
            );
    else if (x instanceof synUniI)
        return "Uni_I";
    else if (x instanceof Inductive) {
        if (x.trueByAssumption)
            return "@true:assume";
        else
            return "@syn";
    }
    else {
        console.log(x);
        throw new Error("Expected (sub-)class of Inductive");
    }
}

// Attach key bindings to application
function attachKeyBindings() {
    $(document).keydown((e) => {
        if (e.keyCode == 27) {
            $('.closeOverlay, .closeCenteredOverlay').click();
        } // esc

        else if (e.keyCode == 46) {
            stateStack.update(IbStackEvent.DELETE);

            setCurrentState(stateStack.top());
            update();
        } // delete

        else if (e.keyCode == 45) {
            stateStack.update(IbStackEvent.INSERT);
        } // insert
    });
}

function setCurrentState(s: State) {
    currentState = s;
}

// Returns the highest number of asterixes found in the proof
function getNumGeneratedConstants(x: Inductive): number {
    var n = 0;

    if (x instanceof synUniI)
        n++;

    x.premises.forEach(v => {
        n += getNumGeneratedConstants(v);
    });

    return n;
}

//
// UNDO BLOCK
//

enum IbStackEvent {
    DELETE,
    INSERT,
    UPDATE,
    UPDATE_INTERNAL
}

class IbStack {
    stack: State[];
    markedIndex: number;

    constructor(s: State) {
        this.reset(s);
    }

    update(e: IbStackEvent, s: State = null) {
        if (e == IbStackEvent.INSERT) {
            this.markedIndex = null;

            return;
        }

        else if (e == IbStackEvent.DELETE && (this.stack.length <= 1 || this.markedIndex == 0)) {
            return;
        }

        else {
            if (e == IbStackEvent.DELETE) {
                if (this.markedIndex !== null)
                    this.markedIndex--;
                else
                    this.markedIndex = this.stack.length - 2;

                this.stack.push(copyState(this.stack[this.markedIndex]));
            }

            else {
                if (s == null)
                    throw new Error();

                this.markedIndex = null;
                
                // On update the current state is kept as top,
                // instead the "previous" step is pushed to second last position
                if (e == IbStackEvent.UPDATE) {
                    this.stack.push(this.top());
                    this.stack[this.stack.length - 2] = s;
                } else {
                    this.stack.push(s);
                }
            }
        }
    }

    top() {
        return this.stack[this.stack.length - 1];
    }

    reset(s: State) {
        this.stack = [s];
        this.markedIndex = null;
    }
};

function prepareCurrentStateUpdate() {
    var s = copyState(currentState);

    stateStack.update(IbStackEvent.UPDATE, s);
}

function copyState(s: State): State {
    var x: State = new State;

    var refs = [];
    var ltIndices: number[][] = []

    x.p = copyInductive(s.p, refs);

    x.xs = [];
    s.xs.forEach((e, i) => x.xs[i] = copyUnknown(e, refs[i], s.xs, ltIndices));

    ltIndices.forEach((lts, i) => {
        lts.forEach(j => {
            x.xs[i].linkedTo.push(x.xs[j]);
        });
    });

    x.gc = s.gc;

    return x;
}

function copyInductive(x: Inductive, refs: any[]): Inductive {
    var i: Inductive;

    // Copy
    var g = copyFormula(x.goal, refs);
    var cpas = copyAssumptions(x);

    // Inst. new object of same type
    if (x instanceof synBool) {
        i = new synBool(g, cpas.as);
    }

    else if (x instanceof synConE1) {
        i = new synConE1(g, cpas.as);
    }

    else if (x instanceof synConE2) {
        i = new synConE2(g, cpas.as);
    }

    else if (x instanceof synConI) {
        i = new synConI(g, cpas.as);
    }

    else if (x instanceof synDisE) {
        i = new synDisE(g, cpas.as);
    }

    else if (x instanceof synDisI1) {
        i = new synDisI1(g, cpas.as);
    }

    else if (x instanceof synDisI2) {
        i = new synDisI2(g, cpas.as);
    }

    else if (x instanceof synExiE) {
        i = new synExiE(g, cpas.as);
    }

    else if (x instanceof synExiI) {
        i = new synExiI(g, cpas.as);
    }

    else if (x instanceof synUniE) {
        i = new synUniE(g, cpas.as);

        (<synUniE> i).waitingForTermSelection = x.waitingForTermSelection;
    }

    else if (x instanceof synUniI) {
        i = new synUniI(g, cpas.as);
    }

    else if (x instanceof synImpE) {
        i = new synImpE(g, cpas.as);
    }

    else if (x instanceof synImpI) {
        i = new synImpI(g, cpas.as);
    }

    else {
        i = new Inductive(g, cpas.as);
    }

    if (g === null) {
        // Goal is unknown
        refs.push(i);
    }

    for (var j = 0; j < cpas.n; j++)
        refs.push(i);

    var ps = [];
    x.premises.forEach(i => ps.push(copyInductive(i, refs)));
    i.premises = ps;

    return i;
}

function copyUnknown(x: Unknown, ref: any, xs: Unknown[], ltIndices: number[][]): Unknown {
    var u: Unknown = { x: ref };

    if (x.inAssumption !== undefined)
        u.inAssumption = x.inAssumption;

    if (x.inFm !== undefined)
        u.inFm = x.inFm;

    if (x.inTm !== undefined)
        u.inTm = x.inTm;

    var lts: number[] = [];

    if (x.linkedTo !== undefined) {
        u.linkedTo = [];

        x.linkedTo.forEach((u, i) => {
            var z = xs.indexOf(u);

            if (z !== -1)
                lts.push(z);
        });
    }

    ltIndices.push(lts);

    return u;
}

//
// END OF UNDO
//