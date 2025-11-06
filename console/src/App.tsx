import {BrowserRouter,Routes, Route} from "react-router"
import Dashboard from "./pages/dashboard"
import Playground from "./pages/playground"
import Container from "./components/app/Container"
export default function App() {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Container><Dashboard/></Container>}/>
          <Route path="/playground/:id" element={<Playground/>}/>
        </Routes>
      </BrowserRouter>
    </div>
  )
}

