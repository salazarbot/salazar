import {
    ActionRowBuilder,
    BaseInteraction,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Colors,
    EmbedBuilder,
    Guild,
    MessageFlags,
    PermissionsBitField
} from "discord.js";
import * as Server from "./Server.js";
import { chunkifyText, simplifyString } from "./StringUtils.js";

/**
 * Obtém o contexto do roleplay para um servidor específico.
 * @param {Guild} guild - Objeto guild do Discord
 * @returns {Promise<string | undefined>} Contexto completo do roleplay 
 */
export async function getContext(guild) {
    if (typeof guild !== "object") throw new Error("A guild deve ser um objeto de servidor.");

    const serverConfig = await Server.config(guild.id);
    if (!serverConfig?.server?.channels?.context) return undefined;
    
    const contextChannel = guild.channels.cache.get(serverConfig.server.channels.context);
    if (!contextChannel) return undefined;
    if (contextChannel.type != ChannelType.GuildForum) return undefined;
    
    await contextChannel.threads.fetch({}, {cache: true});

    // Primeiro, cria um array de Promises
    const threadPromises = contextChannel.threads.cache
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(async thread => {
            const messages = await thread.messages.fetch({limit: 100});
            return messages
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                .map(m => m.content)
                .join('\n');
        });

    // Aguarda todas as Promises serem resolvidas
    const threadContents = await Promise.all(threadPromises);
    
    // Junta todos os conteúdos das threads
    const finalContext = threadContents.join('\n\n');

    return finalContext;
}

/**
 * Adiciona ao contexto do roleplay para um servidor específico.
 * @param {String} text - Contexto a adicionar
 * @param {Guild} guild - Objeto guild do Discord
 * @returns {Promise<string | undefined>} Contexto completo do roleplay 
 */
export async function addContext(text, guild) {
    const serverConfig = await Server.config(guild.id);
    const contextChannel = guild.channels.cache.get(serverConfig?.server?.channels?.context);
    if(!contextChannel) return undefined;

    return chunkifyText(text).length < 5 && chunkifyText(text).forEach(async chunk => {
        await contextChannel.threads.cache.sort((a, b) => b.createdTimestamp - a.createdTimestamp).first().send(chunk);
    })
}

/**
 * Diálogo de pegar um país
 * @param {string} selectedCountry 
 * @param {BaseInteraction} interaction 
 */
export async function countryPickDialog(selectedCountry, interaction) {

    const responseText = `Você pediu ${selectedCountry}! Agora é só aguardar a resposta da administração.`
    interaction.isModalSubmit() ? 
        await interaction.reply({ content: responseText, flags: [MessageFlags.Ephemeral] })
    : 
        await interaction.update({ content: responseText, components: [] });
    
    const unfilteredCountry = selectedCountry.replaceAll('-', ' ').toUpperCase();
    const country = simplifyString(unfilteredCountry);
    if (!country) return;

    const serverConfig = await Server.config(interaction.guildId);
    const countryCategory = interaction.guild.channels.cache.get(serverConfig?.server?.channels?.country_category);
    
    const existingChannel = countryCategory?.children?.cache.find(c => simplifyString(c.name).includes(country));
    const existingRole = interaction.guild.roles.cache.find(r => simplifyString(r.name).includes(country));
    
    let replyEmbed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle(`${interaction.member.displayName} escolheu o país "${unfilteredCountry}"`)
    .setFooter({text: "Aguarde ou peça para que algum administrador aprove ou não a sua escolha."})
    .addFields([
        { name: '🎌 País solicitado', value: unfilteredCountry, inline: true },
        { name: '👥 ID do jogador', value: interaction.user.id, inline: true }
    ]);

    existingChannel && existingRole && replyEmbed.addFields([{ name: '⚠️ Tudo certo, administrador!', value: `Aparentemente o país já tem um cargo e canal, que serão setados se escolher Permitir. Administrador, apenas verifique se o país escolhido já não tem dono(a).` }]);
    existingChannel && !existingRole && replyEmbed.addFields([{ name: '⚠️ País possui apenas canal', value: `O canal para o país **${country}** existe (<#${existingChannel.id}>) **mas ele não tem um cargo!** Se acredita que isso é um erro, prefira setar manualmente.` }]);
    !existingChannel && existingRole && replyEmbed.addFields([{ name: '⚠️ País possui apenas cargo', value: `O cargo para o país **${country}** existe (<@&${existingRole.id}>) **mas ele não tem um canal, ou a categoria de países não está configurada corretamente!** Se acredita que isso é um erro, prefira setar manualmente.` }]);
    !existingChannel && !existingRole && replyEmbed.addFields([{ name: '⚠️ Nota para o administrador', value: `Nenhum canal ou cargo para o país **${country}** foi encontrado. Um novo canal e cargo serão criados **automaticamente** se você escolher Permitir. Se você acredita que isso é um erro, por favor, prefira setar manualmente, e adicione o cargo existente a(o) jogador(a).` }]);
    existingRole && existingRole.members.size>0 && replyEmbed.addFields([{name: '⚠️ País já tem dono!', value: `O(s) jogador(es) <@${existingRole?.members?.map(member => member.id).join('> <@')}> já têm o cargo desse país. Confira se o coop foi consentido.`}])

    interaction.channel.send({
        content: process.env.MAINTENANCE ? `-# pings vão aqui` : `-# <@&${interaction.guild.roles.cache.filter(r => !r.managed && !r.name.toLowerCase().includes('bot') && r.permissions.has(PermissionsBitField.Flags.ManageRoles)).map(r => r.id).join('> <@&')}>`,
        embeds: [replyEmbed],
        components: [
            new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                .setCustomId('country_pick_deny')
                .setLabel(`Não permitir`)
                .setStyle(ButtonStyle.Secondary)
            )
            .addComponents(
                new ButtonBuilder()
                .setCustomId('country_pick_manual')
                .setLabel(`Vou setar manualmente`)
                .setStyle(ButtonStyle.Secondary)
            )
            .addComponents(
                new ButtonBuilder()
                .setCustomId('country_pick_allow')
                .setLabel(`Permitir`)
                .setStyle(ButtonStyle.Success)
            )
        ]
    });
}

/**
 * Obtém a data atual do roleplay para um servidor específico.
 * @param {Guild} guild - Objeto guild do Discord
 * @returns {Promise<string | undefined>} Contexto completo do roleplay 
 */
export async function getCurrentDate(guild) {
    if (typeof guild !== "object") throw new Error("A guild deve ser um objeto de servidor.");

    const serverConfig = await Server.config(guild.id);
    if (!serverConfig?.server?.channels?.time) return undefined;
    if (!guild.channels.cache.has(serverConfig.server.channels.time)) return undefined;
    
    return simplifyString((await guild.channels.cache.get(serverConfig?.server?.channels?.time)?.messages?.fetch())?.first()?.cleanContent || '', true)
}

/**
 * Passa o ano do roleplay para um servidor específico.
 * @param {Guild} guild - Objeto guild do Discord
 * @param {Number} currentYear - Ano antigo do RP
 * @param {Number} newYear - Ano novo do RP
 * @param {Boolean} auto - Se o bot deve informar o ano ao passar
 */
export async function passYear(guild, currentYear, newYear, auto=false) {
    if (typeof guild !== "object") throw new Error("A guild deve ser um objeto de servidor.");
    if (typeof currentYear !== "number" || typeof newYear !== "number") throw new Error("Um dos parâmetros de ano está incorreto");

    const serverConfig = await Server.config(guild.id);
    if (!guild || !currentYear || !newYear || !serverConfig) return;

    // Detecta se o período é um ano completo ou parcial
    let fullYearPassed = false;
    // Exemplo: se a mensagem contém "fim do ano" ou "final do ano" ou "ano completo"
    if (newYear !== currentYear) {
        // Se o ano mudou, provavelmente é um ano completo
        fullYearPassed = true;
    }

    serverConfig?.server?.name?.includes('{ano}') && await guild.setName(`${serverConfig?.server?.name?.replace('{ano}', newYear)}`);

    const contextChannel = guild.channels.cache.get(serverConfig?.server?.channels?.context);
    if (!contextChannel || contextChannel.type != ChannelType.GuildForum) return;

    if(fullYearPassed) {
        contextChannel.threads.create({
            name: newYear || currentYear,
            message: {
                content: `Eventos, ações e acontecimentos de ${newYear || currentYear}.`
            }
        });
    }
}

/**
 * Obtém a lista de jogadores do roleplay para um servidor específico.
 * @param {Guild} guild - Objeto guild do Discord
 * @returns {Promise<string | undefined>} Contexto completo do roleplay 
 */
export async function getAllPlayers(guild) {
    if (typeof guild !== "object") throw new Error("A guild deve ser um objeto de servidor.");

    const serverConfig = await Server.config(guild.id);
    if (!serverConfig?.server?.channels?.picked_countries) return undefined;
    if (!guild.channels.cache.has(serverConfig.server.channels.picked_countries)) return undefined;
    
    return (await guild.channels.cache.get(serverConfig?.server?.channels?.picked_countries)?.messages?.fetch())
        ?.sort()
        ?.map(msg => msg.cleanContent)
        ?.join('\n');
}

/**
 * Obtém a lista de guerras ativas no roleplay
 * @param {Guild} guild - Objeto guild do Discord
 * @returns {Promose<string | undefined>} Lista completa das guerras passadas
 */
export async function getWars(guild) {
    if (typeof guild !== "object") throw new Error("A guild deve ser um objeto de servidor.");

    const serverConfig = await Server.config(guild.id);
    if (!serverConfig?.server?.channels?.war) return undefined;
    const warsChannel = guild.channels.cache.get(serverConfig?.server?.channels?.war);
    if (!warsChannel || warsChannel.type != ChannelType.GuildForum) return undefined;

    await warsChannel.threads.fetch({}, {cache: true});

    // Primeiro, cria um array de Promises
    const threadPromises = warsChannel.threads.cache
        ?.sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        ?.filter(thread => !thread.locked)
        ?.map(async thread => {
            try {
                const starterMsg = await thread.fetchStarterMessage();
                return `${thread.name}\n${starterMsg?.cleanContent}\n### ID da thread da guerra: ${thread.id}`;
            } catch (err) {
                // Se a mensagem não existe mais, apenas pula ou retorna info básica
                return `${thread.name}\n[Mensagem inicial não encontrada]\n### ID da thread da guerra: ${thread.id}`;
            }
        });

    // Aguarda todas as Promises serem resolvidas
    const threadContents = await Promise.all(threadPromises);
    
    // Junta todos os conteúdos das threads
    const finalWars = threadContents.join('\n\n');

    return finalWars;
}

/**
 * Embed de enviar ação de guerra
 */
export const warActionSendEmbed = {
    embeds: [
        new EmbedBuilder()
        .setTitle('Novo turno de guerra')
        .setDescription('Mande sua ação para a guerra enquanto há tempo!')
        .setColor(Colors.Red)
        .setFooter({text: 'Não leia a ação do amiguinho! Eu, o Salazar, irei PREJUDICAR ATIVAMENTE jogadores que fazem metagaming.'})
    ],
    components: [
        new ActionRowBuilder()
        .addComponents([
            new ButtonBuilder()
            .setCustomId('war_action')
            .setStyle(ButtonStyle.Primary)
            .setLabel('Enviar ação de guerra'),
            new ButtonBuilder()
            .setCustomId('war_narrate')
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Gerar narração')
        ])
    ]
}