import { useNavigate } from "react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Database,
  Layers,
  Clock,
  ArrowRight,
  ChevronDownIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function ProjectTable({
  projects,
}: {
  projects: Array<{
    id: string;
    name: string;
    dbType: string;
    tablesCount: number;
    lastModified: string;
  }>;
}) {
  const [createResource, setCreateResource] = useState(false);
  const router = useNavigate();

  const handleRowClick = (id: string) => {
    router(`/playground/${id}`);
  };

  const getDbColor = (dbType: string) => {
    const colors: Record<string, string> = {
      PostgreSQL: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      MySQL: "bg-orange-500/10 text-orange-400 border-orange-500/20",
      MongoDB: "bg-green-500/10 text-green-400 border-green-500/20",
      SQLite: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    };
    return colors[dbType] || "bg-gray-500/10 text-gray-400 border-gray-500/20";
  };

  return (
    <div className="w-5xl mx-auto space-y-5 p-4">
      <Popover onOpenChange={setCreateResource}>
        <PopoverTrigger>
          <ResourceButton />
        </PopoverTrigger>
        <PopoverContent side="bottom" className="w-96">
          <ResourcePopoverContent />
        </PopoverContent>
      </Popover>

      {/* Header Section */}
      <div className="mb-4 flex items-center justify-between px-1">
        <p className="text-sm text-gray-400">
          {projects.length} {projects.length === 1 ? "project" : "projects"} in
          total
        </p>
      </div>

      {/* Table Card */}
      <div
        className={`bg-[#2a2a2a] rounded-lg border border-gray-700/50 overflow-hidden ${
          createResource ? "blur-xs" : "blur-none"
        }`}
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-[#232323] hover:bg-[#232323] border-b border-gray-700/50">
              <TableHead className="font-medium text-gray-300 py-3.5 text-sm">
                Project Name
              </TableHead>
              <TableHead className="font-medium text-gray-300 text-sm">
                Database
              </TableHead>
              <TableHead className="font-medium text-gray-300 text-sm">
                Tables
              </TableHead>
              <TableHead className="font-medium text-gray-300 text-sm">
                Last Modified
              </TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12">
                  <div className="flex flex-col items-center justify-center text-gray-500">
                    <Database className="w-12 h-12 mb-3 opacity-30" />
                    <p className="text-sm font-medium">No projects yet</p>
                    <p className="text-xs mt-1 text-gray-600">
                      Create your first project to get started
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              projects.map((project) => (
                <TableRow
                  key={project.id}
                  onClick={() => handleRowClick(project.id)}
                  className="cursor-pointer hover:bg-[#323232] transition-all duration-150 group border-b border-gray-700/30 last:border-0"
                >
                  <TableCell className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="font-medium text-gray-100 group-hover:text-white transition-colors">
                        {project.name}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${getDbColor(
                        project.dbType
                      )}`}
                    >
                      <Database className="w-3.5 h-3.5" />
                      {project.dbType}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-gray-300">
                      <Layers className="w-4 h-4 text-gray-500" />
                      <span className="font-medium">{project.tablesCount}</span>
                      <span className="text-xs text-gray-500">
                        {project.tablesCount === 1 ? "table" : "tables"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-gray-300 text-sm">
                      <Clock className="w-4 h-4 text-gray-500" />
                      {project.lastModified}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ArrowRight className="w-5 h-5 text-gray-600 group-hover:text-gray-300 group-hover:translate-x-0.5 transition-all duration-200" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ResourceButton() {
  return (
    <Button className="w-36 cursor-pointer gap-2 whitespace-nowrap focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 shadow hover:bg-primary/90 h-9 py-2 group bg-primary text-primary-foreground ring-primary before:from-primary-foreground/20 after:from-primary-foreground/10 relative isolate inline-flex items-center justify-center overflow-hidden rounded-md px-3 text-left text-sm font-medium ring-1 transition duration-300 ease-[cubic-bezier(0.4,0.36,0,1)] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-md before:bg-linear-to-b before:opacity-80 before:transition-opacity before:duration-300 before:ease-[cubic-bezier(0.4,0.36,0,1)] after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:rounded-md after:bg-linear-to-b after:to-transparent after:mix-blend-overlay">
      New Resource
      <ChevronDownIcon />
    </Button>
  );
}

export function ResourcePopoverContent() {
  const databases = [
    { name: "MySQL", icon: "🐬" },
    { name: "Postgres", icon: "🐘" },
    { name: "SQLite", icon: "🔑" },
  ];

  return (
    <div className="w-full p-2">
      {/* Databases Section */}
      <div className="mb-4">
        <h4 className="text-white font-semibold text-xs mb-3 flex items-center gap-2">
          <Database className="w-4 h-4" />
          Bring your existing databases
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {databases.map((db) => (
            <Button
              variant="outline"
              key={db.name}
              className="flex items-center gap-2.5 px-3 py-2.5 text-left group curopo"
            >
              <span className="text-lg">{db.icon}</span>
              <span className="text-gray-300 text-sm group-hover:text-white transition-colors">
                {db.name}
              </span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
