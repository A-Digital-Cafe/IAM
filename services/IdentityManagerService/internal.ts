import type { Model } from "mongoose";
import type { UserManager, OrgManager, RoleManager, TwoFactorManager } from "./dao/index.js";
import type { DiscordGuildConfig } from "./domain/index.js";
import { SystemRole } from "@common/types/identity/systemRoles.js";
import type { EmailBinder, IdentityDiscordApi, IdentityInternalApi } from "@common/types/identity/IIdentityManagerService.js";

/**
 * Constructores de las superficies internas de Identity. Los contratos (`IdentityInternalApi`,
 * `IdentityAvatarApi`, `IdentityDiscordApi`) viven en `@common` para que los consumidores no
 * dependan de este preset; acá queda sólo el armado.
 */

type DiscordConfigPrivate = { discordGuildId?: string; discordRoleMap?: Record<string, string> };

/** Construye la superficie users/orgs/roles. Los managers ya deben estar inicializados. */
export function buildInternalApi(
	users: UserManager,
	organizations: OrgManager,
	roles: RoleManager,
	twoFactor: TwoFactorManager,
	bindEmailNeutrally: EmailBinder,
	ingestProviderAvatar: IdentityInternalApi["ingestProviderAvatar"]
): IdentityInternalApi {
	/** Los roles globales van sin `orgId`; los de una organización lo llevan. */
	const isAdminRole = async (roleId: string): Promise<boolean> => {
		const role = await roles.getRole(roleId).catch(() => null);
		return role?.name === SystemRole.ADMIN;
	};

	return {
		users,
		organizations,
		roles,
		twoFactor,
		bindEmailNeutrally,
		ingestProviderAvatar,

		isAdminAccount: async (userId: string): Promise<boolean> => {
			const user = await users.getUser(userId).catch(() => null);
			if (!user) return false;

			const roleIds = [...(user.roleIds || []), ...(user.orgMemberships || []).flatMap((membership) => membership.roleIds || [])];
			for (const roleId of roleIds) {
				if (await isAdminRole(roleId)) return true;
			}
			return false;
		},
		/**
		 * IDs de usuarios con un **rol global** por nombre (ej. `SystemRole.ADMIN`). Usa los
		 * managers sin auth; por eso vive tras el gate (enumeraría destinatarios privilegiados).
		 */
		getUserIdsByRoleName: async (roleName: string): Promise<string[]> => {
			const role = await roles.getRoleByName(roleName).catch(() => null);
			if (!role?.id) return [];
			return (await users.getUsersByRole(role.id)) ?? [];
		},
	};
}

/** Construye la superficie Discord (Role ID → nombre de rol; DB por guild con fallback a config). */
export function buildDiscordApi(
	discordGuildConfigModel: Model<DiscordGuildConfig> | null,
	configPrivate: DiscordConfigPrivate
): IdentityDiscordApi {
	return {
		discordGuildId: configPrivate.discordGuildId,
		getDiscordRoleMap: async (guildId: string): Promise<Record<string, string> | null> => {
			if (discordGuildConfigModel) {
				try {
					const doc = await discordGuildConfigModel.findOne({ guildId });
					if (doc) return (doc.toObject?.() || doc).roleMap;
				} catch {
					/* fallback a config.json */
				}
			}
			if (guildId === configPrivate.discordGuildId && configPrivate.discordRoleMap) {
				return configPrivate.discordRoleMap;
			}
			return null;
		},
	};
}
