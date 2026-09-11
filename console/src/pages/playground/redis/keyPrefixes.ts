import type { RedisKeyModel } from "@/lib/sdk";

/**
 * Grouping a keyspace by its prefixes.
 *
 * Redis has no folders, but almost every keyspace is named as though it does:
 * `user:7:sessions`, `queue:jobs`, `cache:page:home`. A flat list of a thousand
 * such keys is unreadable, and the shape of the naming is the only structure
 * there is, so the browser builds it back.
 */

/** The separator nearly every Redis convention uses. */
export const SEPARATOR = ":";

/** Below this many keys, a tree hides more than it shows. */
export const TREE_THRESHOLD = 8;

export interface KeyNode {
  /** The full prefix down to here, so it can be reopened and searched. */
  path: string;
  /** Just this level's name. */
  name: string;
  children: KeyNode[];
  /** Set when this node is a key, not only a prefix. */
  key?: RedisKeyModel;
  /** Every key at or under this node. */
  count: number;
}

function emptyNode(path: string, name: string): KeyNode {
  return { path, name, children: [], count: 0 };
}

/**
 * Build the prefix tree.
 *
 * A prefix that holds exactly one key is folded back into it, so `cache` with
 * only `cache:home` under it reads as `cache:home` rather than as a folder you
 * have to open to find one thing.
 */
export function buildTree(keys: RedisKeyModel[]): KeyNode[] {
  const root = emptyNode("", "");

  for (const key of keys) {
    const parts = key.key.split(SEPARATOR);
    let node = root;
    node.count += 1;

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join(SEPARATOR);
      let child = node.children.find((item) => item.name === part);
      if (!child) {
        child = emptyNode(path, part);
        node.children.push(child);
      }
      child.count += 1;
      if (index === parts.length - 1) child.key = key;
      node = child;
    });
  }

  return collapse(root.children);
}

/** Fold a chain of single-child prefixes into one row. */
function collapse(nodes: KeyNode[]): KeyNode[] {
  return nodes.map((node) => {
    let current = node;
    let name = node.name;

    while (!current.key && current.children.length === 1) {
      const only = current.children[0];
      name = `${name}${SEPARATOR}${only.name}`;
      current = only;
    }

    return {
      ...current,
      name,
      children: collapse(current.children),
    };
  });
}

/** Every prefix in the tree, for opening it all at once. */
export function allPrefixes(nodes: KeyNode[]): string[] {
  const paths: string[] = [];
  const walk = (list: KeyNode[]) => {
    for (const node of list) {
      if (node.children.length) {
        paths.push(node.path);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return paths;
}

/** The prefixes that have to be open for a key to be visible. */
export function prefixesFor(key: string): string[] {
  const parts = key.split(SEPARATOR);
  return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join(SEPARATOR));
}
