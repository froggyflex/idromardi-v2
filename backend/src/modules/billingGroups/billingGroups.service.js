const db = require("../../config/db");
const { v4: uuid } = require("uuid");

async function getByCondominio(condominioId) {
  const [rows] = await db.query(
    `
    SELECT id, nome, condominio_id, created_at
    FROM billing_groups
    WHERE condominio_id = ?
    ORDER BY nome ASC
    `,
    [condominioId]
  );

  return rows;
}

async function getWithUtenze(condominioId) {
  const [groups] = await db.query(
    `
    SELECT bg.id, bg.nome
    FROM billing_groups bg
    WHERE bg.condominio_id = ?
    `,
    [condominioId]
  );

  for (const g of groups) {
    const [utenze] = await db.query(
      `
      SELECT *
      FROM utenze_v2
      WHERE billing_group_id = ?
      AND stato = 'ATTIVA'
      `,
      [g.id]
    );

    g.utenze = utenze;
  }

  return groups;
}


async function create(condominioId, nome) {
  const id = uuid();

  await db.query(
    `
    INSERT INTO billing_groups (id, condominio_id, nome)
    VALUES (?, ?, ?)
    `,
    [id, condominioId, nome]
  );

  const [rows] = await db.query(
    `SELECT id, nome, condominio_id FROM billing_groups WHERE id = ?`,
    [id]
  );

  return rows[0];
}

async function remove(id) {
  const [check] = await db.query(
    `SELECT COUNT(*) as count FROM utenze_v2 WHERE billing_group_id = ?`,
    [id]
  );

  if (check[0].count > 0) {
    throw new Error("Billing group is used by existing utenze");
  }

  await db.query(
    `DELETE FROM billing_groups WHERE id = ?`,
    [id]
  );
}

module.exports = {
  getByCondominio,
  create,
  remove,
};