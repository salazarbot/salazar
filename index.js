import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import botConfig from "./config.json" with { type: "json" };
import client from "./src/Client.js";
import cron from "node-cron";
import express from "express";
import cors from "cors";
import "dotenv/config";
import { ChannelType } from "discord.js";

// API
const app = express();
const port = 55003;

// Simular __dirname e __filename no ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Eventos
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith(".js"));
for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const eventModule = await import(pathToFileURL(path.resolve(filePath)).href);
    const event = eventModule.default || eventModule; // Suporte para export default

    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}

// Handler para eventos periódicos (timed)
const timedPath = path.join(__dirname, 'timed');
const timedFiles = fs.existsSync(timedPath) ? fs.readdirSync(timedPath).filter(file => file.endsWith(".js")) : [];
for (const file of timedFiles) {
    const filePath = path.join(timedPath, file);
    const timedModule = await import(pathToFileURL(path.resolve(filePath)).href);
    const timed = timedModule.default || timedModule;

    if (timed.cron && typeof timed.execute === "function") {
        cron.schedule(timed.cron, async () => {
            try {
                await timed.execute();
                console.log(`[Timed] Executado: ${timed.name}`);
            } catch (err) {
                console.error(`[Timed] Erro ao executar ${timed.name}:`, err);
            }
        });
        console.log(`[Timed] Registrado: ${timed.name} (${timed.cron})`);
    }
}

// API
app.use(cors({
    origin: '*', // Temporariamente aceita qualquer origem
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}))
// Middleware para logs
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`)
    next()
})
app.listen(port, () => {
    console.log(`API ligada em http://localhost:${port}`);
});
app.get('/api/get_channels', (req, res) => {
    const guildId = req.query.guildId;

    if(!guildId) {
        return res.status(400).json({ message: 'Erro: guildId não definida no query' });
    }

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ message: 'Guild não encontrada' });
        }

        const channels = guild.channels.cache.map(c => c.toJSON());
        return res.status(200).json(channels);
        
    } catch (error) {
        console.error('Erro ao buscar canais:', error);
        return res.status(500).json({ message: 'Erro interno', error: error.message });
    }
});
app.get('/api/get_roles', (req, res) => {
    const guildId = req.query.guildId;
    
    // Correção 1: status() antes de json()
    if(!guildId) {
        return res.status(400).json({ message: 'Erro: guildId não definida no query' });
    }

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ message: 'Guild não encontrada' });
        }

        const roles = guild.roles.cache.map(r => r.toJSON());
        return res.status(200).json(roles);
        
    } catch (error) {
        console.error('Erro ao buscar cargos:', error);
        return res.status(500).json({ message: 'Erro interno', error: error.message });
    }
});

// Crash handle
process.on('uncaughtException', async (err, origin) => {
    console.error(`Exceção não capturada.`, err, origin);
});
process.on('unhandledRejection', async (reason, promise) => {
    console.error(`Rejeição não manuseada.`, reason, promise);
});

// Logar o cliente
client.login(process.env.DISCORD_TOKEN);
