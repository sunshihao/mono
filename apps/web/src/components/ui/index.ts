/**
 * UI 收拢层统一出口 —— apps/web 所有页面/组件一律从这里 import 组件，
 * 禁止直接 import @material-tailwind/react（内部实现全在其下的包装文件里）。
 * 以后全局换肤/换色/换库只改本目录。
 */
export { Button } from "./button";
export type { ButtonProps } from "./button";
export { Badge } from "./badge";
export {
    Card,
    CardHeader,
    CardContent,
    CardTitle,
    CardDescription,
} from "./card";
export { Input } from "./input";
export { Textarea } from "./textarea";
export { Select, Option } from "./select";
export type { SelectProps } from "./select";
export { TabBar } from "./tabs-bar";
export type { TabItem, TabBarProps } from "./tabs-bar";
export { Menu, MenuHandler, MenuList, MenuItem } from "./menu";
export { Spinner } from "./spinner";
