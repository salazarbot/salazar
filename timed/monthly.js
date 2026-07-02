import client from "../src/Client.js";
import "dotenv/config";
import { MongoClient, ServerApiVersion } from "mongodb";
import botConfig from "../config.json" with { type: "json" };

export default {
    name: 'monthly',
    cron: '0 0 2 * *',

    async execute() {
        const mongoClient = new MongoClient(process.env.DB_URI, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
        });

        try {
            await mongoClient.connect();

            const [configurationDocs, setupDocs] = await Promise.all([
                mongoClient.db('Salazar').collection('configuration').find({ server_tier: { $in: [2, 3] } }).project({ server_id: 1, server_tier: 1, server: 1 }).toArray(),
                mongoClient.db('Salazar').collection('setup').find({ server_tier: { $in: [2, 3] } }).project({ server_id: 1, server_tier: 1, server: 1 }).toArray(),
            ]);

            const servers = new Map();

            for (const doc of [...configurationDocs, ...setupDocs]) {
                const serverId = doc.server_id?.toString();
                if (!serverId || servers.has(serverId)) continue;

                const guild = client.guilds.cache.get(serverId) || await client.guilds.fetch(serverId).catch(() => null);
                const displayName = guild?.name || doc.server?.name || `Servidor ${serverId}`;

                servers.set(serverId, {
                    id: serverId,
                    name: displayName,
                    plan: doc.server_tier,
                    present: Boolean(guild),
                });
            }

            const owner = client.users.cache.get(botConfig.owners[0]) || await client.users.fetch(botConfig.owners[0]).catch(() => null);
            if (!owner) return;

            const lines = ["# Servidores a cobrar:"];

            if (servers.size === 0) {
                lines.push("- Nenhum servidor com plano 2 ou 3 encontrado na base.");
            } else {
                for (const server of [...servers.values()].sort((a, b) => a.name.localeCompare(b.name))) {
                    const planName = botConfig.plans?.[server.plan] || `Plano ${server.plan}`;
                    lines.push(`- ${server.name} (${server.id})\n  - ${planName}${server.present ? "" : "\n  - ⚠️ o bot não está neste servidor"}`);
                }
            }

            await owner.send(lines.join("\n"));
        } catch (error) {
            console.error("Erro ao gerar lista de cobrança mensal:", error);
        } finally {
            await mongoClient.close();
        }
    }
}