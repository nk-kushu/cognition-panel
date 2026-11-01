export const PLANNING_INSTRUCTIONS = `Decide what to build, using the findings and skill results.
Do not edit files. Return:
{"summary":"the approach",
 "tests":[{"id":"t1","behavior":"one behavior or related scenario group","type":"a requested test type","files":["test files and fixtures"]}],
 "components":[{"id":"c1","description":"what it is for","file":"path","signatures":["class, method or function signatures"]}],
 "changes":[{"id":"m1","description":"one small change","file":"path","symbols":["functions or methods it implements"]}],
 "packages":["any package the change must add"]}
Split work so that each change is one method or a related method group.
Leave "symbols" empty only for files that are not code.`;
