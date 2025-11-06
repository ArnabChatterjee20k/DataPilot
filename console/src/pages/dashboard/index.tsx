import { ProjectTable } from "./project-table";

const projects = [
  {
    id: "1",
    name: "Local SQLite DB",
    dbType: "SQLite",
    tablesCount: 12,
    lastModified: "2 days ago",
  },
  {
    id: "2",
    name: "Postgres Cluster",
    dbType: "PostgreSQL",
    tablesCount: 9,
    lastModified: "5 hours ago",
  },
]


export default () => {
  return (
    <>
      <ProjectTable projects={projects}/>
    </>
  );
};
