import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
console.log("root", root);
root.render(<App />);
