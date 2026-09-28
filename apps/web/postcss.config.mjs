/** @type {import('postcss-load-config').Config} */
// Tailwind v4：插件换成 @tailwindcss/postcss（内置 import 处理与厂商前缀，
// 故不再需要 autoprefixer）；daisyUI 经 CSS 里的 @plugin 指令挂载，不经 PostCSS。
const config = {
    plugins: {
        "@tailwindcss/postcss": {},
    },
};

export default config;
