import type {
  Folder,
  Item,
  Node,
  Root,
  Separator,
} from "fumadocs-core/page-tree";
import { Book } from "lucide-react";
import { createElement } from "react";
import * as v from "valibot";

const sidebarIcons = { Book };
type SidebarIconName = keyof typeof sidebarIcons;

export const sidebarIconSchema = v.picklist(
  Object.keys(sidebarIcons) as SidebarIconName[],
);

type SidebarLabel<T> = Omit<T, "name" | "description" | "icon"> & {
  name: string | undefined;
  description?: string;
  icon?: SidebarIconName;
};

type SidebarPage = SidebarLabel<Item>;
type SidebarFolder = SidebarLabel<Omit<Folder, "children" | "index">> & {
  children: SidebarNode[];
  index?: SidebarPage;
};
type SidebarNode = SidebarPage | SidebarFolder | SidebarLabel<Separator>;
type SidebarTree = Omit<
  Root,
  "name" | "description" | "children" | "fallback"
> & {
  name: string | undefined;
  description?: string;
  children: SidebarNode[];
  fallback?: SidebarTree;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function label({
  name,
  description,
  icon,
}: {
  name?: unknown;
  description?: unknown;
  icon?: unknown;
}) {
  return {
    name: text(name),
    description: text(description),
    icon: v.is(sidebarIconSchema, icon) ? icon : undefined,
  };
}

function sidebarNodeData(node: Node): SidebarNode {
  if (node.type === "folder") {
    return {
      ...node,
      ...label(node),
      index: node.index && { ...node.index, ...label(node.index) },
      children: node.children.map(sidebarNodeData),
    };
  }
  return { ...node, ...label(node) };
}

export function sidebarTreeData(tree: Root): SidebarTree {
  return {
    ...tree,
    name: text(tree.name),
    description: text(tree.description),
    children: tree.children.map(sidebarNodeData),
    fallback: tree.fallback && sidebarTreeData(tree.fallback),
  };
}

function renderIcon(name: SidebarIconName | undefined) {
  return name && createElement(sidebarIcons[name]);
}

function renderSidebarNode(node: SidebarNode): Node {
  const icon = renderIcon(node.icon);
  if (node.type === "folder") {
    return {
      ...node,
      icon,
      index: node.index && { ...node.index, icon: renderIcon(node.index.icon) },
      children: node.children.map(renderSidebarNode),
    };
  }
  return { ...node, icon };
}

export function renderSidebarTree(tree: SidebarTree): Root {
  return {
    ...tree,
    children: tree.children.map(renderSidebarNode),
    fallback: tree.fallback && renderSidebarTree(tree.fallback),
  };
}
