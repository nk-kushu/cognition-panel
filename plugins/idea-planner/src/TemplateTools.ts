import type { JsonValue } from "kushibot";
import type { IToolSet } from "./ResearchTools";
import { ToolUseError } from "./ResearchTools";
import type { TemplateCatalog } from "./TemplateCatalog";

/** Told to the model in the instructions; the ids must match `call`. */
export const TEMPLATE_TOOL_DESCRIPTIONS = [
  'list_templates {} — every template: key, name, description, category, required infrastructure. Call this first.',
  'read_template {"key":"<template key>"} — the template descriptor (atlas.template.yml), README and its list of text files.',
  'read_template_file {"key":"<template key>","path":"<relative path from read_template>"} — one docs or source file of a template.',
];

/** Read-only access to scaffolding/templates. */
export class TemplateTools implements IToolSet {
  readonly ids = ["list_templates", "read_template", "read_template_file"];

  constructor(
    private readonly catalog: TemplateCatalog,
    private readonly progress: (message: string) => void,
  ) {}

  async call(toolId: string, args: Record<string, unknown>): Promise<JsonValue> {
    switch (toolId) {
      case "list_templates":
        this.progress("Listing the templates");
        return { templates: this.catalog.list() };
      case "read_template":
        this.progress(`Reading template ${String(args.key)}`);
        return this.catalog.overview(String(args.key));
      default:
        if (typeof args.path !== "string") throw new ToolUseError("path is required.");
        this.progress(`Reading ${String(args.key)}/${args.path}`);
        return this.catalog.file(String(args.key), args.path);
    }
  }
}
