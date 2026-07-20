import net from "node:net";
import { WebSocketServer } from "ws";

const FRAME_HEADER_LEN = 4;

function parseTarget(target) {
    const parts = target.split(":");
    if (parts.length === 2) {
        return { host: parts[0], port: parseInt(parts[1], 10) };
    }
    return { path: target };
}

export default function gatewayBridge(options = {}) {
    const { target, path } = options;

    return {
        name: "gateway-bridge",
        configureServer(server) {
            if (!target) {
                console.warn("[gateway-bridge] No target specified, plugin disabled");
                return;
            }

            const tcpOptions = parseTarget(target);
            const wss = new WebSocketServer({ noServer: true });

            server.httpServer.prependListener("upgrade", (req, socket, head) => {
                const url = new URL(req.url, "http://localhost");
                if (url.pathname !== path) return;
                wss.handleUpgrade(req, socket, head, ws => {
                    wss.emit("connection", ws, req);
                });
            });

            wss.on("connection", ws => {
                const tcp = net.connect(tcpOptions);
                let tcpBuffer = Buffer.alloc(0);

                tcp.on("connect", () => {
                    console.log(`[gateway-bridge] TCP connected to ${target}`);
                });

                ws.on("message", (data, isBinary) => {
                    if (!isBinary) return;
                    const payload = Buffer.from(data);
                    const header = Buffer.alloc(FRAME_HEADER_LEN);
                    header.writeUInt32BE(payload.length, 0);
                    tcp.write(Buffer.concat([header, payload]));
                });

                tcp.on("data", chunk => {
                    tcpBuffer = Buffer.concat([tcpBuffer, chunk]);
                    while (tcpBuffer.length >= FRAME_HEADER_LEN) {
                        const payloadLen = tcpBuffer.readUInt32BE(0);
                        if (payloadLen === 0 || tcpBuffer.length < FRAME_HEADER_LEN + payloadLen) {
                            break;
                        }
                        const payload = tcpBuffer.subarray(FRAME_HEADER_LEN, FRAME_HEADER_LEN + payloadLen);
                        if (ws.readyState === ws.OPEN) {
                            ws.send(payload);
                        }
                        tcpBuffer = tcpBuffer.subarray(FRAME_HEADER_LEN + payloadLen);
                    }
                });

                const cleanup = () => {
                    tcp.destroy();
                };
                ws.on("close", cleanup);
                ws.on("error", cleanup);
                tcp.on("close", () => {
                    console.log("[gateway-bridge] TCP closed");
                    ws.close();
                });
                tcp.on("error", err => {
                    console.error("[gateway-bridge] TCP error:", err.message);
                    ws.close();
                });
            });

            console.log(`[gateway-bridge] WebSocket bridge ready at ws://<dev>${path} -> tcp://${target}`);
        }
    };
}
