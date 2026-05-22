import toolsJson from './tools.json';

export interface ToolParameterDef {
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolDef {
  name: string;
  type: 'introspection' | 'mutation';
  description: string;
  parameters: Record<string, ToolParameterDef>;
}

export interface ToolsSchema {
  $schema: string;
  version: string;
  tools: ToolDef[];
}

export const TOOLS_SCHEMA: ToolsSchema = toolsJson as ToolsSchema;
export const TOOLS: ToolDef[] = TOOLS_SCHEMA.tools;

export function getToolByName(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function getMutationTools(): ToolDef[] {
  return TOOLS.filter((t) => t.type === 'mutation');
}

export function getIntrospectionTools(): ToolDef[] {
  return TOOLS.filter((t) => t.type === 'introspection');
}
