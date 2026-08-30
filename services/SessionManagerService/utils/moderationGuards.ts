import { UncommonResponse, type ClearCookie } from "@services/core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import type { ModerationLookupService } from "../types.js";
import { buildErrorUrl } from "./errorRedirect.js";

interface LoggerLike {
	logWarn: (msg: string) => void;
}

/**
 * Qué hacer cuando el servicio de moderación **no está cargado**.
 *
 * Los guards eran fail-open: sin moderación devolvían sin comprobar nada, así que un nodo al que le
 * faltara el servicio dejaba entrar cuentas e IPs baneadas y nada en el camino de login lo decía.
 * Como `ModerationService` viaja en el mismo preset que este servicio, que falte con el login
 * andando es un despliegue roto, no una configuración.
 *
 * Se cierra por defecto y se abre a propósito con `AUTH_REQUIRE_BAN_ENFORCEMENT=false`, para el
 * despliegue que deliberadamente no tiene moderación. La decisión se resuelve una vez al arrancar y
 * se pasa hasta acá: leerla por request pondría la configuración en el camino caliente del login.
 */
function assertModerationAvailable(required: boolean): void {
	if (!required) return;
	throw new AuthError(503, "AUTH_UNAVAILABLE", "No se puede iniciar sesión ahora mismo. Probá de nuevo en unos minutos.", {});
}

interface RedirectBanOptions {
	moderation: ModerationLookupService | null;
	/** Ver {@link assertModerationAvailable}: sin moderación, `true` rechaza el login. */
	required: boolean;
	email?: string;
	ip?: string;
	clearCookies?: ClearCookie[];
	emailReason?: string;
	ipReason?: string;
}

function toBlockedUntil(expiresAt: Date | null | undefined): number | undefined {
	return expiresAt ? expiresAt.getTime() : undefined;
}

export async function assertIpNotBanned(moderation: ModerationLookupService | null, ip: string | undefined, required: boolean): Promise<void> {
	if (!moderation) return assertModerationAvailable(required);
	if (!ip) return;

	const ipBan = await moderation.isIpBanned(ip);
	if (ipBan.banned) {
		throw new AuthError(403, "ACCOUNT_BANNED", ipBan.reason || "Acceso bloqueado", {
			blockedUntil: toBlockedUntil(ipBan.expiresAt),
		});
	}
}

export async function assertEmailNotBanned(
	moderation: ModerationLookupService | null,
	email: string | undefined,
	required: boolean,
	fallbackReason = "Cuenta baneada"
): Promise<void> {
	if (!moderation) return assertModerationAvailable(required);
	if (!email) return;

	const emailBan = await moderation.isEmailBanned(email);
	if (emailBan.banned) {
		throw new AuthError(403, "ACCOUNT_BANNED", emailBan.reason || fallbackReason, {
			blockedUntil: toBlockedUntil(emailBan.expiresAt),
		});
	}
}

export async function redirectIfRequestBanned(options: RedirectBanOptions): Promise<void> {
	const { moderation, email, ip, required, clearCookies, emailReason = "Cuenta baneada", ipReason = "Acceso bloqueado" } = options;
	if (!moderation) {
		if (!required) return;
		// En el camino de OAuth el usuario vuelve de un tercero: un 503 crudo lo deja en una página en
		// blanco, así que se lo manda a la misma pantalla de error que el resto de este flujo.
		throw UncommonResponse.redirect(buildErrorUrl("/oauth", { reason: "No se puede iniciar sesión ahora mismo. Probá de nuevo en unos minutos." }), {
			status: 302,
			clearCookies,
		});
	}

	if (email) {
		const emailBan = await moderation.isEmailBanned(email);
		if (emailBan.banned) {
			throw UncommonResponse.redirect(buildErrorUrl("/banned", { reason: emailBan.reason || emailReason }), { status: 302, clearCookies });
		}
	}

	if (!ip) return;

	const ipBan = await moderation.isIpBanned(ip);
	if (ipBan.banned) {
		throw UncommonResponse.redirect(buildErrorUrl("/banned", { reason: ipBan.reason || ipReason }), { status: 302, clearCookies });
	}
}

export async function recordLoginAttemptIp(
	moderation: ModerationLookupService | null,
	userId: string,
	ip: string | undefined,
	logger: LoggerLike
): Promise<void> {
	// Sigue siendo best-effort a propósito: es una escritura de telemetría, no un control de acceso.
	if (!moderation || !ip) return;

	await moderation.recordLoginAttemptIp(userId, ip).catch((e: any) => logger.logWarn(`recordLoginAttemptIp: ${e?.message || e}`));
}
