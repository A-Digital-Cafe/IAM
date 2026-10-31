import { RegisterEndpoint, type EndpointCtx } from "@services/core/EndpointManagerService/index.js";
import { HttpError } from "@common/types/ADCCustomError.ts";
import { ACTION_FLAGS } from "@common/types/Actions.ts";
import { RESOURCE_MAP } from "@common/types/resources.ts";
import type { Permission } from "@common/types/identity/Permission.js";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.js";
import { hasPermission } from "@common/utils/perms.ts";
import { authenticateClient, type IntrospectionClient } from "../domain/introspection/clients.js";
import * as IS from "./schemas/introspection.js";

interface IntrospectionDeps {
	clients: IntrospectionClient[];
	verify: ISessionVerifier["verifyToken"];
	extras: (userId: string, orgId?: string) => Promise<{ hasFreshUser: boolean; perms: Permission[]; roles: string[]; isAdmin: boolean }>;
}

const INACTIVE = { active: false } as const;

/**
 * Introspección de tokens de sesión (RFC 7662) para servidores de recursos **fuera** del kernel.
 *
 * El token de sesión es un JWE con clave simétrica que rota: nadie de afuera puede validarlo, y
 * `/api/auth/session` sólo lee la cookie y cuenta por IP (todos los usuarios de un backend externo
 * comparten la suya). Esto cubre ese hueco sin exponer la clave: el cliente se autentica con su
 * secreto y recibe identidad, roles y sólo los permisos de los recursos que tiene declarados.
 */
export class IntrospectionEndpoints {
	static #deps: IntrospectionDeps | null = null;

	static init(deps: IntrospectionDeps): void {
		IntrospectionEndpoints.#deps = deps;
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/introspect",
		permissions: [],
		options: {
			tag: "SessionManagerService/Auth",
			summary: "Introspección de un token de sesión (RFC 7662)",
			description:
				"Para backends externos declarados en `ADC_INTROSPECTION_CLIENTS`. Autenticación `Basic clientId:secreto`; cuerpo " +
				"`application/x-www-form-urlencoded` con `token`. Devuelve `{ active: false }` ante cualquier token inválido, vencido o de " +
				"una cuenta que ya no existe, sin decir por qué. Con `active: true` incluye `sub`, `username`, `exp`, `org_id`, los nombres " +
				"de rol del contexto, `is_admin` (Admin global en contexto personal) y los permisos efectivos —con el `*` expandido— " +
				"**sólo** de los recursos del cliente, en formato `recurso.scope.acciones`. Sin clientes declarados responde 404.",
			skipIdempotency: true,
			skipCsrf: true,
			// Todo un backend llega desde una sola IP: el cupo por defecto (120 mutaciones/min) lo ahogaría.
			rateLimit: { max: 1200, timeWindow: 60_000 },
			schema: { body: IS.IntrospectBody, response: { 200: IS.IntrospectResponse } },
		},
	})
	static async introspect(ctx: EndpointCtx<Record<string, string>, Record<string, string | undefined>>) {
		const deps = IntrospectionEndpoints.#deps;
		if (!deps?.clients.length) throw new HttpError(404, "INTROSPECTION_DISABLED", "No hay clientes de introspección declarados.");

		const client = authenticateClient(ctx.headers?.authorization, deps.clients);
		if (!client) throw new HttpError(401, "INVALID_CLIENT", "Credenciales de cliente inválidas.");

		const token = ctx.data?.token?.trim();
		if (!token) return INACTIVE;

		const result = await deps.verify(token);
		const user = result.valid ? result.session?.user : undefined;
		if (!user) return INACTIVE;

		const extras = await deps.extras(user.id, user.orgId);
		// Sin identity no se puede confirmar que la cuenta siga existiendo: se falla cerrado.
		if (!extras.hasFreshUser) return INACTIVE;

		return {
			active: true,
			sub: user.id,
			username: user.username,
			exp: toEpochSeconds(result.session?.expiresAt),
			client_id: client.clientId,
			token_type: "access_token",
			...(user.orgId ? { org_id: user.orgId } : {}),
			roles: extras.roles,
			is_admin: extras.isAdmin,
			perms: effectivePerms(extras.perms, client.resources),
		};
	}
}

function toEpochSeconds(value: number | string | Date | undefined): number | undefined {
	if (value === undefined) return undefined;
	const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
	return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/** Por cada scope de los recursos del cliente, las acciones que el usuario tiene (con `*` expandido). */
function effectivePerms(perms: readonly Permission[], resources: readonly string[]): string[] {
	const out: string[] = [];
	for (const resource of resources) {
		for (const scope of RESOURCE_MAP.get(resource)?.scopes ?? []) {
			let actions = 0;
			for (const flag of Object.values(ACTION_FLAGS.flags)) if (hasPermission(perms, resource, flag, scope.value)) actions |= flag;
			if (actions) out.push(`${resource}.${scope.value}.${actions}`);
		}
	}
	return out;
}
