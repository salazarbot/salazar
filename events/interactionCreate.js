import { 
    BaseInteraction,
    EmbedBuilder,
    Colors,
    Collection,
    MessageFlags,
    ButtonInteraction,
    ChatInputCommandInteraction,
    AutocompleteInteraction,
    ModalSubmitInteraction
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import botConfig from "../config.json" with { type: "json" };
import * as Server from "../src/Server.js";
import client from "../src/Client.js";
import { inspect } from "util";

// Simular __dirname e __filename no ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

client.commands = await getCommands(path.join(__dirname, "../commands"));

export default {
    name: 'interactionCreate',
    
    /**
     * @param {BaseInteraction} interaction 
     */
    async execute(interaction) {

        if (interaction.isChatInputCommand()) {
            await handleChatInput(interaction);
        }  else if (interaction.isButton()) {
            await handleButton(interaction);
        } else if (interaction.isAutocomplete()) {
            await handleAutocomplete(interaction);
        } else if (interaction.isAnySelectMenu()) {
            await handleSelectMenu(interaction);
        } else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction);
        }

    }
};

// Funções auxiliares

/**
 * @param {ChatInputCommandInteraction} interaction 
 */
async function handleChatInput(interaction) {
    
    const interactionContent = interaction.options._hoistedOptions.length > 0
        ? interaction.options._hoistedOptions.map(x => `**${capitalize(x.name)}:** \`\`\`${x.value}\`\`\``)
        : "";

    const subcom = interaction.options.getSubcommand(false) ? ` ${interaction.options.getSubcommand()}` : "";

    const command = client.commands.get(interaction.commandName);
    !command.disable_defer && await interaction.deferReply(command.ephemeral && {flags: [MessageFlags.Ephemeral]});

    console.log(`- ${interaction.member.user.username} (${interaction.member.id}) usou ${interaction.commandName} em ${interaction.channel?.name} (${interaction.channel?.guild.name})`);

    try {
        if (!interaction.replied) {
            await command.execute(interaction).catch(() => {});
        }
    } catch (error) {
        console.error(error);
    }

    const serverConfig = await Server.config(interaction.guildId);
    const logChannel = interaction.guild.channels.cache.get(serverConfig?.server?.channels?.logs);

    if (logChannel) {
        const fields = [
            { name: `👤  Usuário`, value: `<@${interaction.user.id}> (${interaction.user.id})` },
            { name: `🤖  Comando`, value: `${interaction.commandName}${subcom}` }
        ];

        interactionContent && fields.push({ name: `🔖  Conteúdo`, value: `${interactionContent.join("\n")}` });

        fields.push({ name: `💬  Canal`, value: `<#${interaction.channelId}> (${interaction.channel.id})` });

        await logChannel.send({
            embeds: [
                new EmbedBuilder()
                .setTitle(`🤖  Registro de comando`)
                .setFields(fields)
                .setThumbnail(interaction.user.avatarURL({ dynamic: true }))
                .setColor(Colors.Blurple)
                .setTimestamp(interaction.createdAt)
            ]
        });
    }
}

/**
 * @param {ButtonInteraction} interaction 
 */
async function handleButton(interaction) {

    client.buttons = new Collection();
    const buttonsPath = path.join(__dirname, "../buttons");
    const buttonFiles = fs.readdirSync(buttonsPath).filter(file => file.endsWith(".js"));

    for (const file of buttonFiles) {
        const fileUrl = pathToFileURL(path.resolve(path.join(buttonsPath, file))).href;
        const { default: button } = await import(fileUrl);
        const buttonName = path.basename(file, ".js");
        client.buttons.set(buttonName, button);
    }

    const baseId = interaction.customId.split(":")[0];
    const buttonHandler = client.buttons.get(baseId);
    if (!buttonHandler) return;

    await buttonHandler.execute(interaction);

    const serverConfig = await Server.config(interaction.guildId);
    const logChannel = interaction.guild.channels.cache.get(serverConfig?.server?.channels?.logs);

    if (logChannel) {
        await logChannel.send({
            embeds: [
                new EmbedBuilder()
                .setTitle(`🤖  Registro de uso de botão`)
                .setFields([
                    { name: `👤  Usuário`, value: `<@${interaction.user.id}> (${interaction.user.id})` },
                    { name: `🤖  Informações`, value: `\`\`\`json\n${inspect(interaction.component?.toJSON(), {depth: 0}).slice(0, 990)}\n\`\`\`` },
                    { name: `💬  Canal`, value: `${interaction.message.url} (${interaction.channel.id})` }
                ])
                .setThumbnail(interaction.user.avatarURL({ dynamic: true }))
                .setColor(Colors.Yellow)
                .setTimestamp(interaction.createdAt)
            ]
        });
    }
}

/**
 * @param {AutocompleteInteraction} interaction
 */
async function handleAutocomplete(interaction) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (command && typeof command.autocomplete === 'function') {
        await command.autocomplete(interaction);
    }
}

/**
 * @param {import("discord.js").AnySelectMenuInteraction} interaction
 */
async function handleSelectMenu(interaction) {

    // Carrega selects dinamicamente
    client.selects = new Collection();
    const selectsPath = path.join(__dirname, "../selects");
    if (fs.existsSync(selectsPath)) {
        const selectFiles = fs.readdirSync(selectsPath).filter(file => file.endsWith(".js"));
        for (const file of selectFiles) {
            const fileUrl = pathToFileURL(path.resolve(path.join(selectsPath, file))).href;
            const { default: select } = await import(fileUrl);
            const selectName = path.basename(file, ".js");
            client.selects.set(selectName, select);
        }
    }

    // Handler pelo customId
    const baseId = interaction.customId.split(":")[0];
    const selectHandler = client.selects?.get(baseId);
    if (!selectHandler) return;

    await selectHandler.execute(interaction);

    const serverConfig = await Server.config(interaction.guildId);

    // Log igual antes
    const logChannel = interaction.guild.channels.cache.get(serverConfig?.server?.channels?.logs);
    if (logChannel) {
        await logChannel.send({
            embeds: [
                new EmbedBuilder()
                .setTitle(`🤖  Registro de uso de select menu`)
                .setFields([
                    { name: `👤  Usuário`, value: `<@${interaction.user.id}> (${interaction.user.id})` },
                    { name: `🤖  Informações`, value: `\`\`\`json\n${inspect(interaction.component?.toJSON(), {depth: 0}).slice(0, 990)}\n\`\`\`` },
                    { name: `💬  Canal`, value: `${interaction.message.url} (${interaction.channel.id})` }
                ])
                .setThumbnail(interaction.user.avatarURL({ dynamic: true }))
                .setColor(Colors.Yellow)
                .setTimestamp(interaction.createdAt)
            ]
        });
    }
}

/**
 * @param {ModalSubmitInteraction} interaction
 */
async function handleModalSubmit(interaction) {

    // Carrega modals dinamicamente
    client.modals = new Collection();
    const modalsPath = path.join(__dirname, "../modals");
    if (fs.existsSync(modalsPath)) {
        const modalFiles = fs.readdirSync(modalsPath).filter(file => file.endsWith(".js"));
        for (const file of modalFiles) {
            const fileUrl = pathToFileURL(path.resolve(path.join(modalsPath, file))).href;
            const { default: modal } = await import(fileUrl);
            const modalName = path.basename(file, ".js");
            client.modals.set(modalName, modal);
        }
    }

    // Handler pelo customId
    const baseId = interaction.customId.split(":")[0];
    const modalHandler = client.modals?.get(baseId);
    if (!modalHandler) return;

    await modalHandler.execute(interaction);

    const serverConfig = await Server.config(interaction.guildId);

    // Log igual antes
    const logChannel = interaction.guild.channels.cache.get(serverConfig?.server?.channels?.logs);
    if (logChannel) {
        await logChannel.send({
            embeds: [
                new EmbedBuilder()
                .setTitle(`🤖  Registro de uso de modal`)
                .setFields([
                    { name: `👤  Usuário`, value: `<@${interaction.user.id}> (${interaction.user.id})` },
                    { name: `🤖  Informações`, value: `\`\`\`json\n${inspect(interaction.component?.toJSON(), {depth: 0}).slice(0, 990)}\n\`\`\`` },
                    { name: `💬  Canal`, value: `${interaction.message.url} (${interaction.channel.id})` }
                ])
                .setThumbnail(interaction.user.avatarURL({ dynamic: true }))
                .setColor(Colors.Yellow)
                .setTimestamp(interaction.createdAt)
            ]
        });
    }
}

/**
 * @param {string} dir 
 */
async function getCommands(dir) {
    const commands = new Collection();
    const commandFiles = getFiles(dir);

    for (const commandFile of commandFiles) {
        const fileUrl = pathToFileURL(path.resolve(commandFile)).href;
        const { default: command } = await import(fileUrl);
        commands.set(command.data.toJSON().name, command);
    }

    return commands;
}

/**
 * @param {string} dir 
 */
function getFiles(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    let commandFiles = [];

    for (const file of files) {
        if (file.isDirectory()) {
            commandFiles = [
                ...commandFiles,
                ...getFiles(path.join(dir, file.name))
            ];
        } else if (file.name.endsWith(".js")) {
            commandFiles.push(path.join(dir, file.name));
        }
    }

    return commandFiles;
}

/**
 * @param {string} str 
 */
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}