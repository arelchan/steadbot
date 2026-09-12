import type { ServerResponse } from 'node:http';

/**
 * HTTP 路由里抄了三遍的那点东西。只收 json()——readBody 没收：它在 index.ts 里有五份，
 * 而且互不相同（/upload/ 那份带 50MB 上限和 req.destroy()），合并会悄悄给上传去掉限制。
 */
export const sendJson = (res: ServerResponse, code: number, body: unknown): true => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
  return true;
};
