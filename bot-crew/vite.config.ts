import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 领域类型和协议在 crew-server/src/shared/ 里，前后端同一份。放在服务端的 src/ 下面是有原因的：
// 仓库根的 .gitignore 是白名单（提交不上去，且 git add 不报错），Docker 的 build context 是
// crew-server/，compose 只挂 ../src ../scripts ../library——放根目录那份代码永远到不了容器里。
const shared = fileURLToPath(new URL('../crew-server/src/shared', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': shared } },
  // shared 里有值导出（CHANNEL_LABEL、botThread…），不是纯类型模块，dev server 会真的去拉它；
  // 而仓库根没有 package.json，Vite 探不到 workspace root，默认只放行 bot-crew/。
  server: { fs: { allow: ['..'] } },
});
