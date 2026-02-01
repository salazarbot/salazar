import { 
    Client, 
    EmbedBuilder,
    Colors,
    IntentsBitField,
    Partials,
    SnowflakeUtil,
    Routes 
} from "discord.js";
import fs from "fs";
import path from "path";
import { REST } from "@discordjs/rest";
import botConfig from "../config.json" with { type: "json" };
import { config, setup } from "./Server.js";
import { pathToFileURL } from "url";

const client = new Client({
    intents: [
        IntentsBitField.Flags.GuildExpressions,
        IntentsBitField.Flags.GuildIntegrations,
        IntentsBitField.Flags.GuildInvites,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessagePolls,
        IntentsBitField.Flags.GuildMessageReactions,
        IntentsBitField.Flags.GuildMessageTyping,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.GuildModeration,
        IntentsBitField.Flags.GuildPresences,
        IntentsBitField.Flags.GuildScheduledEvents,
        IntentsBitField.Flags.GuildVoiceStates,
        IntentsBitField.Flags.GuildWebhooks,
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.DirectMessages,
        IntentsBitField.Flags.AutoModerationConfiguration,
        IntentsBitField.Flags.AutoModerationExecution,
    ],
    partials: [
        Partials.Message,
        Partials.GuildMember,
        Partials.Reaction,
        Partials.Channel,
        Partials.ThreadMember,
        Partials.User,
        Partials.GuildScheduledEvent,
    ],
});

/**
 * Cliente do bot
 * @returns Cliente do bot
 */
export default client;

/**
 * Envia uma mensagem de anúncio para todos os servidores do bot
 * @param {Object} properties
 * @param {string} properties.title Título da mensagem
 * @param {string} properties.message Mensagem a ser enviada 
 */
export function announce({
    title = 'Anúncio do Bot',
    message,
    description,
    color = Colors.Green,
}) {
    const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(message || description || "Nenhuma mensagem foi definida.");

    client.guilds.cache.forEach(async (guild) => {
        if (guild.systemChannel) { 
            guild.systemChannel.send({ embeds: [embed] }) 
        } else if (guild.publicUpdatesChannel) { 
            guild.publicUpdatesChannel.send({ embeds: [embed] }) 
        } else { 
            try { 
                (await guild.fetchOwner()).user.send({ 
                    embeds: [
                        embed.setFooter(`Se você, dono(a) do ${guild.name} não quiser mais receber notificações assim no seu privado, por favor defina um canal do sistema ou um canal de atualizações públicas no seu servidor.`)
                    ] 
                }) 
            } catch (err) { } 
        } 
    })
}

/**
 * @param {string} dir 
 */
export function getFiles(dir) {
    const files = fs.readdirSync(dir, {
        withFileTypes: true,
    });

    let commandFiles = [];

    for (const file of files) {
        if (file.isDirectory()) {
            commandFiles = [
                ...commandFiles,
                ...getFiles(`${dir}/${file.name}`),
            ];
        } else if (file.name.endsWith(".js")) {
            commandFiles.push(`${dir}/${file.name}`);
        }
    }

    return commandFiles;
}

/**
 * Normaliza uma opção de comando recursivamente
 * @param {Object} option - Opção a ser normalizada
 * @returns {Object} - Opção normalizada
 */
function normalizeOption(option) {
    const normalized = {
        type: option.type,
        name: option.name,
        description: option.description,
        required: option.required || false,
        choices: option.choices || undefined,
        options: option.options ? option.options.map(normalizeOption) : undefined
    };

    // Remove propriedades undefined para evitar diferenças
    Object.keys(normalized).forEach(key => {
        if (normalized[key] === undefined) {
            delete normalized[key];
        }
    });

    return normalized;
}

/**
 * Normaliza um comando para comparação, removendo propriedades específicas da API
 * @param {Object} command - Comando a ser normalizado
 * @returns {Object} - Comando normalizado
 */
function normalizeCommand(command) {
    const normalized = {
        name: command.name,
        description: command.description,
        type: command.type || 1, // Default para CHAT_INPUT
        options: command.options ? command.options.map(normalizeOption) : [],
        default_member_permissions: command.default_member_permissions || null,
        dm_permission: command.dm_permission !== undefined ? command.dm_permission : true
    };

    // Remove propriedades undefined para evitar diferenças
    Object.keys(normalized).forEach(key => {
        if (normalized[key] === undefined) {
            delete normalized[key];
        }
    });

    return normalized;
}

/**
 * Compara dois arrays de comandos para ver se são iguais
 * @param {Array} currentCommands - Comandos atuais do servidor
 * @param {Array} newCommands - Novos comandos a serem registrados
 * @returns {boolean} - true se os comandos são iguais
 */
function compareCommands(currentCommands, newCommands) {
    if (currentCommands.length !== newCommands.length) {
        return false;
    }

    // Normaliza e ordena os comandos para comparação consistente
    const normalizedCurrent = currentCommands.map(normalizeCommand).sort((a, b) => a.name.localeCompare(b.name));
    const normalizedNew = newCommands.map(normalizeCommand).sort((a, b) => a.name.localeCompare(b.name));

    // Compara cada comando
    for (let i = 0; i < normalizedCurrent.length; i++) {
        const current = normalizedCurrent[i];
        const newCmd = normalizedNew[i];

        // Compara usando JSON.stringify após normalização
        if (JSON.stringify(current) !== JSON.stringify(newCmd)) {
            //console.log(`- Comando ${current.name} é diferente:`);
            //console.log('  Atual:', JSON.stringify(current, null, 2));
            //console.log('  Novo:', JSON.stringify(newCmd, null, 2));
            return false;
        }
    }

    return true;
}

/**
 * Adiciona os comandos do bot em um servidor
 * @param {SnowflakeUtil} serverId - Id do servidor que receberá os comandos
 */
export async function deployCommands(serverId) {

    const serverConfig = await config(serverId);
    const serverSetup = !serverConfig && await setup(serverId);

    let commands = [];
    const commandFiles = getFiles("./commands");

    for (const file of commandFiles) {
        // Use import dinâmico em ES module
        const fileUrl = pathToFileURL(path.resolve(file)).href;
        const command = (await import(fileUrl)).default;
        if((
            command.min_tier<=serverConfig?.server_tier || 
            !command.min_tier
        ) && (
            command.setup_step<=serverSetup?.server_setup_step || 
            !command.setup_step && command.setup_step!==0 && !serverSetup && serverConfig || 
            command.setup_step<0 || 
            command.setup_step===0 && !serverSetup && !serverConfig
        )) {
            commands.push(command.data.toJSON());
        }
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    // Busca os comandos atuais do servidor
    const guild = await client.guilds.fetch(serverId);
    const currentCommandsCollection = await guild.commands.fetch();
    const currentCommands = Array.from(currentCommandsCollection.values());

    // Compara os comandos atuais com os novos
    if (compareCommands(currentCommands, commands)) {
        return;
    }

    // Registra os comandos apenas se forem diferentes
    try {
        await rest.put(
            Routes.applicationGuildCommands(botConfig.id, serverId),
            { body: commands }
        );
        console.log(`- Comandos registrados em ${guild.name} (${serverId})`);
    } catch (error) {
        console.error(`- Erro ao registrar comandos em ${guild.name} (${serverId}):`, error);
    }
}