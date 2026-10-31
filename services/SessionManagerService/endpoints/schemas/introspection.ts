import { Type } from "@sinclair/typebox";

/** Campos en `snake_case` porque los fija RFC 7662 (y los lee así cualquier cliente estándar). */
export const IntrospectBody = Type.Object({
	token: Type.Optional(Type.String()),
	token_type_hint: Type.Optional(Type.String()),
});

export const IntrospectResponse = Type.Object({
	active: Type.Boolean(),
	sub: Type.Optional(Type.String()),
	username: Type.Optional(Type.String()),
	exp: Type.Optional(Type.Number()),
	client_id: Type.Optional(Type.String()),
	token_type: Type.Optional(Type.String()),
	org_id: Type.Optional(Type.String()),
	roles: Type.Optional(Type.Array(Type.String())),
	is_admin: Type.Optional(Type.Boolean()),
	perms: Type.Optional(Type.Array(Type.String())),
});
