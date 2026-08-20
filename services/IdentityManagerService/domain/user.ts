import { Schema } from "mongoose";
import type { User } from "@common/types/identity/User.ts";
export const userSchema = new Schema<User>(
	{
		id: { type: String, required: true, unique: true },
		username: { type: String, required: true, unique: true },
		passwordHash: { type: String, required: true },
		email: String,
		roleIds: [String],
		groupIds: [String],
		orgMemberships: [
			{
				orgId: String,
				roleIds: [String],
				joinedAt: Date,
			},
		],
		linkedAccounts: [
			{
				provider: { type: String, required: true },
				providerId: { type: String, required: true },
				providerUsername: String,
				providerAvatar: String,
				status: { type: String, enum: ["linked", "unlinked"], default: "linked" },
				linkedAt: { type: Date, default: Date.now },
				unlinkedAt: Date,
			},
		],
		permissions: [
			{
				resource: { type: String, required: true },
				action: { type: Number, required: true }, // Bitfield
				scope: { type: Number, required: true }, // Bitfield
			},
		],
		metadata: Schema.Types.Mixed,
		isActive: { type: Boolean, default: true },
		createdAt: { type: Date, default: Date.now },
		updatedAt: { type: Date, default: Date.now },
		lastLogin: Date,
	},
	{ id: false }
);

/**
 * Orden alfabético del listado admin: Mongo sólo usa un índice para ordenar si la collation de la
 * consulta coincide con la del índice, así que el `unique` binario de `username` no sirve para el
 * orden case-insensitive. Nombre propio obligatorio: no se permiten dos índices con la misma clave
 * que difieran sólo en la collation.
 *
 * Compuesto con `id` porque el DAO desempata por ahí: un índice de un solo campo NO sirve para un
 * sort de dos. Y el DAO desempata en la MISMA dirección (`id: order`) para que descendente sea un
 * recorrido inverso de este índice; con direcciones mixtas (`{username:-1, id:1}`) tampoco aplica.
 * Mantener en sync con `LIST_COLLATION` y el `sort` del DAO: si dejan de coincidir no falla nada,
 * se degrada en silencio a scan completo + sort en memoria.
 */
userSchema.index({ username: 1, id: 1 }, { name: "username_ci", collation: { locale: "es", strength: 2 } });

/**
 * Campos que el update genérico (`UserManager.updateUser`) puede escribir, vía `buildUpdateSet`.
 *
 * `passwordHash` y `lastLogin` quedan FUERA a propósito: tienen sus propios flujos. `id` y
 * `createdAt` son inmutables.
 */
export const USER_UPDATABLE_FIELDS = [
	"username",
	"email",
	"avatar",
	"isActive",
	"roleIds",
	"groupIds",
	"permissions",
	"orgMemberships",
	"linkedAccounts",
	"metadata",
] as const;
