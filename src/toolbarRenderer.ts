import "./index.css";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { ToolbarApp } from "./ToolbarApp";

const root = createRoot(document.getElementById("root")!);
root.render(createElement(ToolbarApp));


