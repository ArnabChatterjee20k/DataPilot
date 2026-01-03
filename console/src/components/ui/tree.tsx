import {
  Accordion,
  AccordionItem,
  FileTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { FolderIcon, FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface NestedTreeNode {
  name: string;
  children?: NestedTreeNode[];
  className?: string;
  disabled?: boolean;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  addChildrenIcon?: LucideIcon | React.ComponentType<{ className?: string }>;
  emptyStateElement?: (node: NestedTreeNode) => React.ReactNode;
  onClick?: (node: NestedTreeNode) => void;
  onAddChildren?: (node: NestedTreeNode) => void;
  menuActions?: (node: NestedTreeNode) => React.ReactNode;
}

interface FlatTreeNode extends Omit<NestedTreeNode, "children"> {
  id: string;
  depth: number;
  parent: string; // Parent ID (or "ROOT")
  children: boolean;
  isEmpty: boolean;
  originalNode: NestedTreeNode; // Store reference to original node for onClick handler
}

export interface ExpandedNodeInfo {
  node: NestedTreeNode;
  depth: number;
}

interface TreeProps {
  nodes: NestedTreeNode[];
  indent?: number;
  onExpand?: (info: ExpandedNodeInfo) => void;
}

function walkTree(
  tree: NestedTreeNode[],
  initial: FlatTreeNode[] = [],
  depth = 0,
  parentId = "ROOT",
  idCounter: { count: number } = { count: 0 }
) {
  tree.forEach((node) => {
    const id = `node-${idCounter.count++}`;
    initial.push({
      id,
      name: node.name,
      depth: depth,
      parent: parentId,
      isEmpty: node.children?.length === 0,
      children: !!node.children, // not using length so that if children has empty array that means it will be an accordion and if on children that means leaf node
      icon: node.icon,
      addChildrenIcon: node.addChildrenIcon,
      emptyStateElement: node.emptyStateElement,
      className: node.className,
      disabled: node.disabled,
      onClick: node.onClick,
      onAddChildren: node.onAddChildren,
      menuActions: node.menuActions,
      originalNode: node,
    });
    if (node?.children)
      walkTree(node.children, initial, depth + 1, id, idCounter);
  });

  return initial;
}

const getAllChildren = (
  parentId: string,
  relation: Map<string, string[]>,
  initial: Set<string> = new Set()
) => {
  const children = relation.get(parentId) || [];
  children.forEach((child) => {
    initial.add(child);
    getAllChildren(child, relation, initial);
  });
  return initial;
};

export default function Tree({ nodes, indent = 10, onExpand }: TreeProps) {
  const flatNodes = walkTree(nodes);
  const childrenMap = new Map<string, string[]>();
  flatNodes.forEach((node) => {
    if (!childrenMap.has(node.parent)) {
      childrenMap.set(node.parent, []);
    }
    childrenMap.get(node.parent)!.push(node.id);
  });
  const [expandedNodes, setExpandedNodes] = useState(new Set<string>());
  // for storing the nodes those were opened before the parent was closed
  const [subExpandedNodes, setSubExpandedNodes] = useState(
    new Map<string, Set<string>>()
  );

  const handleExpand = (nodeIds: string[]) => {
    setExpandedNodes((currentNodeIds) => {
      const newNodeIds = new Set(nodeIds);
      const newSubExpandedNodes = new Map(subExpandedNodes);

      // closing children and storing them in the subExpanded nodes
      currentNodeIds.forEach((node) => {
        if (!newNodeIds.has(node)) {
          const childrens = getAllChildren(node, childrenMap);
          // store what was opened and in present in the openedIds
          newSubExpandedNodes.set(
            node,
            new Set([...childrens].filter((child) => currentNodeIds.has(child)))
          );
          childrens.forEach((child) => newNodeIds.delete(child));
        }
      });

      // reopening subExpandedNodes which were opened
      newNodeIds.forEach((newNode) => {
        if (newSubExpandedNodes.has(newNode)) {
          newSubExpandedNodes.get(newNode)?.forEach((node) => {
            newNodeIds.add(node);
          });
          newSubExpandedNodes.delete(newNode);
        }
      });

      setSubExpandedNodes(newSubExpandedNodes);

      if (onExpand) {
        const newlyExpanded = [...newNodeIds].filter(
          (id) => !currentNodeIds.has(id)
        );
        newlyExpanded.forEach((id) => {
          const flatNode = flatNodes.find((n) => n.id === id);
          if (flatNode) {
            onExpand({
              node: flatNode.originalNode,
              depth: flatNode.depth,
            });
          }
        });
      }

      return newNodeIds;
    });
  };

  const getNodeIcon = (node: FlatTreeNode) => {
    if (node.icon) {
      const IconComponent = node.icon;
      return (
        <IconComponent className="h-4 w-4 shrink-0 mr-1.5 text-accent-foreground/70" />
      );
    }

    if (node.children) {
      return (
        <FolderIcon className="h-4 w-4 shrink-0 mr-1.5 text-accent-foreground/70" />
      );
    }
    return (
      <FileIcon className="h-4 w-4 shrink-0 mr-1.5 text-accent-foreground/70" />
    );
  };

  const handleNodeClick = (node: FlatTreeNode) => {
    if (node.onClick) {
      // Use the stored reference to original node - this preserves the full context
      node.onClick(node.originalNode);
    }
  };

  const handleAddChildren = (node: FlatTreeNode, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the accordion expand/collapse
    if (node.onAddChildren) {
      node.onAddChildren(node.originalNode);
    }
  };

  return (
    <Accordion
      onValueChange={(value) => handleExpand(value)}
      value={[...expandedNodes]}
      type="multiple"
      className="w-full"
    >
      {flatNodes.map(
        (node) =>
          (node.parent === "ROOT" || expandedNodes.has(node.parent)) && (
            <AccordionItem
              key={node.id}
              value={node.id}
              style={{ paddingLeft: node.depth * indent }}
              className={cn("border-b-0", node.className)}
              disabled={node.disabled}
            >
              {node.children || node.parent === "ROOT" ? (
                <>
                  <FileTrigger
                    className="py-2"
                    onClick={() => handleNodeClick(node)}
                  >
                    <div className="flex items-center flex-1">
                      {getNodeIcon(node)}
                      <span>{node.name}</span>
                      {node.addChildrenIcon &&
                        (node.menuActions ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="ml-auto mr-2 p-1 rounded hover:bg-accent transition-colors"
                                onClick={(e) => e.stopPropagation()}
                                title="Menu"
                              >
                                {(() => {
                                  const AddIcon = node.addChildrenIcon!;
                                  return (
                                    <AddIcon className="h-4 w-4 text-accent-foreground/70" />
                                  );
                                })()}
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="center"
                              className="max-w-60"
                              side="right"
                              sideOffset={8}
                            >
                              {node.menuActions(node.originalNode)}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <button
                            className="ml-auto mr-2 p-1 rounded hover:bg-accent transition-colors"
                            onClick={(e) => handleAddChildren(node, e)}
                            title="Add children"
                          >
                            {(() => {
                              const AddIcon = node.addChildrenIcon!;
                              return (
                                <AddIcon className="h-4 w-4 text-accent-foreground/70" />
                              );
                            })()}
                          </button>
                        ))}
                    </div>
                  </FileTrigger>
                  {node.isEmpty &&
                  expandedNodes.has(node.id) &&
                  node.emptyStateElement ? (
                    <AccordionContent>
                      <div className="px-7">
                        {node.emptyStateElement(node.originalNode)}
                      </div>
                    </AccordionContent>
                  ) : null}
                </>
              ) : (
                <div
                  className={cn(
                    "py-2 flex items-center",
                    node.disabled && "opacity-50 cursor-not-allowed"
                  )}
                  onClick={() => !node.disabled && handleNodeClick(node)}
                >
                  {/* spacer to align with chevron */}
                  <span className="inline-flex w-4 mr-1 shrink-0" />
                  {getNodeIcon(node)}
                  <span>{node.name}</span>
                </div>
              )}
            </AccordionItem>
          )
      )}
    </Accordion>
  );
}
