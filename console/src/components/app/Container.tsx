import { type ReactNode } from "react";
export default function Container({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col gap-4 p-4 ">{children}</div>;
}

Container.Grid = ({ children }: { children: ReactNode }) => {
  return <div className="grid auto-rows-min gap-4 md:grid-cols-3">{children}</div>
}