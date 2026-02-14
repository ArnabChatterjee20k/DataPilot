import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import Playground from "./pages/playground";
import Upload from "./pages/upload";
import Container from "./components/app/Container";

export default function App() {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/playground" replace />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/playground/:id" element={<Playground />} />
          <Route path="/upload" element={<Container><Upload /></Container>} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

