import { createRequire } from "node:module";
import type TypeScript from "typescript";

type Ts = typeof TypeScript;
export type DeclarationIssue = Readonly<{ file: string; message: string }>;

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const require = createRequire(import.meta.url);
const NOT_IMPLEMENTED = /^\{\s*throw\s+new\s+\w*Error\(\s*(?:["'`][^"'`]*["'`])?\s*\)\s*;?\s*\}$/;

/**
 * Language-aware edit limits for TypeScript and JavaScript. A file allowlist cannot enforce
 * "only this method" or "declarations only", so these compare parsed code. Other languages
 * return false from `supports`; their files are flagged for the human reviewer instead.
 */
export class DeclarationCheck {
  private readonly ts: Ts = require("typescript") as Ts;

  supports(file: string): boolean {
    return SOURCE.test(file);
  }

  /** New or changed function bodies must be stubs; existing implementations must survive. */
  skeletonIssues(file: string, before: string | null, after: string): readonly DeclarationIssue[] {
    const issues: DeclarationIssue[] = [];
    const previous = before === null ? new Map<string, string>() : this.bodies(file, before);
    for (const [name, body] of this.bodies(file, after)) {
      const old = previous.get(name);
      if (old === undefined || old !== body) {
        if (!NOT_IMPLEMENTED.test(body.trim()))
          issues.push({
            file,
            message: `${name} must have no implementation; use: throw new Error("Not implemented")`,
          });
      }
    }
    for (const name of previous.keys())
      if (!this.bodies(file, after).has(name))
        issues.push({ file, message: `Existing code must be preserved: ${name}` });
    return issues;
  }

  /** Only the bodies of `symbols` may change, and their signatures must stay as approved. */
  scopeIssues(
    file: string,
    before: string,
    after: string,
    symbols: readonly string[],
  ): readonly DeclarationIssue[] {
    const issues: DeclarationIssue[] = [];
    if (this.masked(file, before, symbols) !== this.masked(file, after, symbols))
      issues.push({
        file,
        message: `Only the bodies of ${symbols.join(", ")} may change; signatures and all other code are fixed.`,
      });
    const known = this.bodies(file, after);
    for (const symbol of symbols)
      if (![...known.keys()].some((name) => this.matches(name, symbol)))
        issues.push({ file, message: `Assigned symbol not found: ${symbol}` });
    return issues;
  }

  /** The functions and methods declared in a file, as `name` or `Class.method`. */
  symbols(file: string, content: string): readonly string[] {
    return [...this.bodies(file, content).keys()];
  }

  private matches(name: string, symbol: string): boolean {
    return name === symbol || name.endsWith(`.${symbol}`);
  }

  private masked(file: string, content: string, symbols: readonly string[]): string {
    const ranges: [number, number][] = [];
    this.visit(file, content, (name, body) => {
      if (symbols.some((symbol) => this.matches(name, symbol)))
        ranges.push([body.getStart(), body.getEnd()]);
    });
    return ranges
      .sort((a, b) => b[0] - a[0])
      .reduce((text, [start, end]) => `${text.slice(0, start)}{}${text.slice(end)}`, content);
  }

  private bodies(file: string, content: string): Map<string, string> {
    const found = new Map<string, string>();
    this.visit(file, content, (name, body) => found.set(name, body.getText()));
    return found;
  }

  private visit(
    file: string,
    content: string,
    found: (name: string, body: TypeScript.Node) => void,
  ): void {
    const ts = this.ts;
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const walk = (node: TypeScript.Node, owner: string): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const name = node.name?.text ?? "(class)";
        node.members.forEach((member) => walk(member, owner ? `${owner}.${name}` : name));
        return;
      }
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        const value = node.initializer;
        if ((ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && value.body) {
          found(owner ? `${owner}.${node.name.text}` : node.name.text, value.body);
          return;
        }
      }
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isGetAccessorDeclaration(node) ||
          ts.isSetAccessorDeclaration(node) ||
          ts.isConstructorDeclaration(node)) &&
        node.body
      ) {
        const own = ts.isConstructorDeclaration(node)
          ? "constructor"
          : node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
            ? node.name.text
            : "(anonymous)";
        found(owner ? `${owner}.${own}` : own, node.body);
        return;
      }
      ts.forEachChild(node, (child) => walk(child, owner));
    };
    walk(source, "");
  }
}
