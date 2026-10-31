import { createHash } from "node:crypto";
import { safeEqualHex } from "@common/utils/crypto.ts";
import { RESOURCE_MAP } from "@common/types/resources.ts";

/**
 * Un servidor de recursos externo (otro proceso, otro lenguaje) que necesita saber quién es el
 * dueño de un token de sesión. Se declara a mano, como los clientes OIDC: nadie se anota solo.
 */
export interface IntrospectionClient {
	clientId: string;
	/** SHA-256 hex del secreto: el `config.json` nunca ve el secreto en claro. */
	secretSha256: string;
	/** Recursos cuyos permisos puede ver. Los demás no salen en la respuesta. */
	resources: string[];
}

/**
 * Lee `ADC_INTROSPECTION_CLIENTS`: JSON `[{ clientId, secretSha256, resources[] }]`. Una entrada
 * mal formada se descarta con aviso en vez de tumbar el servicio: deja afuera a ese cliente, no al
 * login de toda la plataforma.
 */
export function readIntrospectionClients(raw: unknown, logger: { logWarn(msg: string): void }): IntrospectionClient[] {
	if (typeof raw !== "string" || !raw.trim()) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		logger.logWarn("[introspect] ADC_INTROSPECTION_CLIENTS no es JSON válido; introspección deshabilitada.");
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const clients: IntrospectionClient[] = [];
	for (const entry of parsed) {
		const c = entry as Partial<IntrospectionClient>;
		const secret = typeof c.secretSha256 === "string" ? c.secretSha256.trim().toLowerCase() : "";
		if (typeof c.clientId !== "string" || !c.clientId.trim() || !/^[0-9a-f]{64}$/.test(secret)) {
			logger.logWarn(`[introspect] cliente descartado (falta clientId o secretSha256 de 64 hex): ${JSON.stringify(c.clientId ?? null)}`);
			continue;
		}
		const resources = Array.isArray(c.resources) ? c.resources.filter((r): r is string => typeof r === "string" && RESOURCE_MAP.has(r)) : [];
		clients.push({ clientId: c.clientId.trim(), secretSha256: secret, resources });
	}
	return clients;
}

/** Autentica `Authorization: Basic base64(clientId:secret)` contra los clientes declarados. */
export function authenticateClient(header: string | undefined, clients: readonly IntrospectionClient[]): IntrospectionClient | null {
	if (!header?.toLowerCase().startsWith("basic ")) return null;
	let decoded: string;
	try {
		decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
	} catch {
		return null;
	}
	const sep = decoded.indexOf(":");
	if (sep <= 0) return null;
	const rawId = decoded.slice(0, sep);
	const rawSecret = decoded.slice(sep + 1);
	const client = clients.find((c) => c.clientId === rawId || c.clientId === safeDecode(rawId));
	if (!client) return null;
	// RFC 6749 §2.3.1 pide form-encoding dentro del Basic y muchos clientes no lo hacen: valen las dos.
	const candidates = new Set([rawSecret, safeDecode(rawSecret)]);
	for (const secret of candidates) {
		const presented = createHash("sha256").update(secret, "utf8").digest("hex");
		if (safeEqualHex(presented, client.secretSha256)) return client;
	}
	return null;
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value.replaceAll("+", " "));
	} catch {
		return value;
	}
}
