import { Button } from "@/components/ui/button";
import { PlayIcon, Loader2 } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useEffect, useRef } from "react";
import { useDatabaseStore, useTabsStore, type Tab } from "./store/store";
import { executeQuery } from "@/lib/sdk";
import { getTablesQuery } from "@/lib/queries";

interface CodeAreaProps {
  tab: Tab;
  content: string;
  onChange: (content: string) => void;
  onRun?: (query: string) => void;
  isRunning?: boolean;
}

export function CodeArea({
  tab,
  content,
  onChange,
  onRun,
  isRunning = false,
}: CodeAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textareaRef.current) {
      if (!content)
        textareaRef.current.placeholder = "# ⌘ B to get AI assistant";
      else textareaRef.current.value = content;
    }
  }, [content]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent =
        content.substring(0, start) + "\t" + content.substring(end);
      onChange(newContent);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="bg-[#0f0f0f] border-r border-[#1a1a1a] px-4 py-3 font-mono text-sm flex justify-between">
        <TableBreadCrumb tab={tab} />
        <Button
          size="sm"
          variant="outline"
          className="cursor-pointer"
          onClick={() => onRun && onRun(textareaRef.current?.value || "")}
          disabled={isRunning || !onRun}
        >
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <PlayIcon className="mr-2 h-4 w-4" />
              Run
            </>
          )}
        </Button>
      </div>
      {/* 
        TODO: on change tab need to save the query state into the zustand store first -> need to be async and non blocking 
        Not save on every key store as it would slow down the editor
      */}
      <div className="flex h-3.5 flex-1 overflow-hidden p-3 bg-[#0f0f0f] border-r border-[#1a1a1a]">
        <div className="flex-1 overflow-hidden relative bg-[#0a0a0a] rounded">
          <textarea
            ref={textareaRef}
            // value={content}
            // onChange={(e) => onChange(e.target.value)}
            rows={1}
            onKeyDown={handleKeyDown}
            className="absolute inset-0 w-full h-full font-mono text-sm text-white placeholder:opacity-35 bg-transparent resize-none outline-none px-4 py-4 leading-6"
            style={{
              color: "transparent",
              caretColor: "white",
              textShadow: "0 0 0 #d1d5db",
              backgroundColor: "#0a0a0a",
            }}
            spellCheck="false"
          />
        </div>
      </div>
    </div>
  );
}

function TableBreadCrumb({ tab }: { tab: Tab }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {tab.connectionId ? (
          <>
            <BreadcrumbItem>{tab.connectionId}</BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        ) : null}
        {tab.databaseName ? (
          <>
            <BreadcrumbItem>{tab.databaseName}</BreadcrumbItem>
          </>
        ) : (
          <QueryConnectionConfig tab={tab} />
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function QueryConnectionConfig({ tab }: { tab: Tab }) {
  const { updateTabConnection } = useTabsStore();
  const { connections, setTablesForConnection } = useDatabaseStore();
  function getConnectionName(connectionId: string) {
    return connections.find((con) => con.id === connectionId)?.name;
  }
  const loadEntities = async (id: string) => {
    const connection = connections.find((conn) => conn.id === id);
    if (!connection) {
      alert("Issues while fetching tables");
      return;
    }
    const query = getTablesQuery(connection.type);
    const response = await executeQuery({
      path: {
        connection_id: id,
        entity_name: "_tables", // Placeholder since we're querying for tables, not a specific table
      },
      query: {
        query: query,
      },
    });

    // Transform rows to entities structure
    const entities = {
      data: {
        entities:
          response.data?.rows.map((row: any) => ({
            name: row.name,
          })) || [],
      },
    };

    setTablesForConnection(
      id,
      entities.data?.entities.map((entity) => ({
        id: entity.name,
        name: entity.name,
      })) || []
    );
  };
  useEffect(() => {
    if (tab.connectionId) loadEntities(tab.connectionId);
  }, [tab.connectionId]);
  return (
    <div>
      <Select
        value={tab.connectionId}
        onValueChange={(connectionId) =>
          // using placeholder as it is not required
          updateTabConnection(
            tab.id,
            connectionId,
            getConnectionName(connectionId),
            "placeholder_table"
          )
        }
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select Connection" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Select Connection</SelectLabel>
            {connections.map((connection) => (
              <SelectItem value={connection.id}>{connection.name}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
