import {
    AttachmentBuilder,
    AutocompleteInteraction,
    ChannelType,
    ChatInputCommandInteraction,
    Colors,
    EmbedBuilder,
    SlashCommandAttachmentOption,
    SlashCommandBuilder,
    SlashCommandStringOption
} from "discord.js";
import * as Server from "../../src/Server.js";
import botConfig from "../../config.json" with { type: "json" };
import { simplifyString } from "../../src/StringUtils.js";
import gis from "g-i-s";
import { getAverageColor, isImageSafe, fetchImageAsPngBuffer } from "../../src/VisualUtils.js";

export default {
    data: new SlashCommandBuilder()
        .setName("carta")
        .setDescription("Cria uma carta de roleplay para o jogador")
        .addStringOption(
            new SlashCommandStringOption()
            .setName('destinatário')
            .setDescription('O destinatário que receberá a carta')
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addStringOption(
            new SlashCommandStringOption()
            .setName("conteúdo")
            .setDescription("O conteúdo da carta")
            .setRequired(true)
        )
        .addAttachmentOption(
            new SlashCommandAttachmentOption()
            .setName('imagem')
            .setRequired(false)
            .setDescription('Anexe uma imagem à carta se quiser')
        ),

    min_tier: 3,
    ephemeral: true,

    /**
     * @param {ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const serverConfig = Server.config(interaction.guildId);
        if(!interaction.member.roles.cache.has((await serverConfig)?.server?.roles?.player)) return interaction.editReply(`Este comando é restrito para jogadores do RP (<@&${(await serverConfig)?.server?.roles?.player}>).`);
        
        if(serverConfig?.server_tier<3) return interaction.editReply({content: `Essa funcionalidade não está disponível no plano atual do servidor (${botConfig.plans[serverConfig?.server_tier]}). Faça o upgrade para o plano ${botConfig.plans[3]} para liberá-la.`});

        const countryCategoryId = (await serverConfig)?.server?.channels?.country_category;
        if(!countryCategoryId || (interaction.channel.parentId != countryCategoryId && interaction.channel.parent.parentId != countryCategoryId)) return interaction.editReply(`Esse comando só pode ser usado no seu chat privado do país.`);
        
        const countryChat = interaction.guild.channels.cache.find(c => simplifyString(c.name).includes(simplifyString(interaction.options.get('destinatário').value)));
        if(!countryChat) return interaction.editReply("Não encontrei o chat desse país.")

        const senderName = interaction.guild.roles.cache.find(r => simplifyString(r.name).includes(simplifyString(interaction.channel.parent.name)) || simplifyString(r.name).includes(simplifyString(interaction.channel.name))).name;
        const serverRoleplayDate = (await (await interaction.guild.channels.fetch((await serverConfig)?.server?.channels?.time)).messages.fetch()).first() || 'antiga';

        await gis(`Bandeira ${senderName} ${serverRoleplayDate}`, async (error, results) => {
            // Aceita SVG, PNG, JPG
            const validResult = results[0];

            const responseContent = `@here`;
            let responseEmbed = new EmbedBuilder()
                .setTitle(`Carta enviada por ${senderName}`)
                .setDescription(interaction.options.get('conteúdo').value);

            if (!error && validResult?.url && isImageSafe(validResult.url)) {
                try {
                    const buffer = await fetchImageAsPngBuffer(validResult.url);
                    // Cria attachment e referencia por URL
                    const attachment = new AttachmentBuilder(buffer, { name: 'flag.png' });
                    responseEmbed.setThumbnail('attachment://flag.png');

                    // Calcula e seta a cor média
                    try {
                        const avgColor = await getAverageColor(validResult.url);
                        responseEmbed.setColor(avgColor);
                    } catch (e) {
                        responseEmbed.setColor(Colors.Blue); // fallback
                    }
                    // Envio com attachment
                    if(interaction.options.getAttachment('imagem') && isImageSafe(interaction.options.getAttachment('imagem').url) && interaction.options.getAttachment('imagem').contentType.startsWith('image')) {
                        responseEmbed.setImage(interaction.options.getAttachment('imagem').url);
                    }
                    // Envio
                    if(countryChat.type === ChannelType.GuildForum) {
                        if(countryChat.threads.cache.find(t => t.name.toLowerCase().includes('caixa de entrada'))) {
                            countryChat.threads.cache.find(t => t.name.toLowerCase().includes('caixa de entrada')).send({content: responseContent, embeds: [responseEmbed], files: [attachment]})
                        } else {
                            countryChat.threads.create({
                                name: `Caixa de Entrada`,
                                message: `Canal destinado à caixa de entrada de cartas enviadas através do comando do ${botConfig.name}`
                            }).then(inbox => {
                                inbox.send(`-# <@&${interaction.guild.roles.cache.find(r => simplifyString(r.name).includes(simplifyString(countryChat.name))).id}>`);
                                inbox.send({content: responseContent, embeds: [responseEmbed], files: [attachment]});
                            })
                        }
                    } else if(countryChat.isTextBased()) {
                        countryChat.send({content: responseContent, embeds: [responseEmbed], files: [attachment]})
                    };

                    interaction.editReply({embeds: [
                        new EmbedBuilder()
                        .setColor(Colors.Green)
                        .setTitle('Carta enviada com sucesso!')
                        .setDescription(`Sua carta foi enviada para ${countryChat.name.replaceAll('-', ' ').toUpperCase()}`)
                    ]});
                } catch (err) {
                    // fallback para URL se buffer falhar
                    responseEmbed.setThumbnail(validResult.url);
                    try {
                        const avgColor = await getAverageColor(validResult.url);
                        responseEmbed.setColor(avgColor);
                    } catch (e) {
                        responseEmbed.setColor(Colors.Blue);
                    }
                    if(interaction.options.getAttachment('imagem') && isImageSafe(interaction.options.getAttachment('imagem').url) && interaction.options.getAttachment('imagem').contentType.startsWith('image')) responseEmbed.setImage(interaction.options.getAttachment('imagem').url);
                    if(countryChat.type === ChannelType.GuildForum) {
                        if(countryChat.threads.cache.find(t => t.name.toLowerCase().includes('caixa de entrada'))) {
                            countryChat.threads.cache.find(t => t.name.toLowerCase().includes('caixa de entrada')).send({content: responseContent, embeds: [responseEmbed]})
                        } else {
                            countryChat.threads.create({
                                name: `Caixa de Entrada`,
                                message: `Canal destinado à caixa de entrada de cartas enviadas através do comando do ${botConfig.name}`
                            }).then(inbox => {
                                inbox.send(`-# <@&${interaction.guild.roles.cache.find(r => simplifyString(r.name).includes(simplifyString(countryChat.name))).id}>`);
                                inbox.send({content: responseContent, embeds: [responseEmbed]});
                            })
                        }
                    } else if(countryChat.isTextBased()) {
                        countryChat.send({content: responseContent, embeds: [responseEmbed]})
                    };
                    interaction.editReply({embeds: [
                        new EmbedBuilder()
                        .setColor(Colors.Green)
                        .setTitle('Carta enviada com sucesso!')
                        .setDescription(`Sua carta foi enviada para ${countryChat.name.replaceAll('-', ' ').toUpperCase()}`)
                    ]});
                }
            } else {
                // Caso não tenha imagem válida, segue fluxo antigo
                if(interaction.options.getAttachment('imagem') && isImageSafe(interaction.options.getAttachment('imagem').url) && interaction.options.getAttachment('imagem').contentType.startsWith('image')) responseEmbed.setImage(interaction.options.getAttachment('imagem').url);
                try {
                    if(countryChat.type === ChannelType.GuildForum) {
                        if(countryChat.threads.cache.find(t => t.name.toLowerCase().includes('caixa de entrada'))) {
                            countryChat.threads.cache.find(t => t.name.toLowerCase().includes('caixa de entrada')).send({content: responseContent, embeds: [responseEmbed]})
                        } else {
                            countryChat.threads.create({
                                name: `Caixa de Entrada`,
                                message: `Canal destinado à caixa de entrada de cartas enviadas através do comando do ${botConfig.name}`
                            }).then(inbox => {
                                inbox.send(`-# <@&${interaction.guild.roles.cache.find(r => simplifyString(r.name).includes(simplifyString(countryChat.name))).id}>`);
                                inbox.send({content: responseContent, embeds: [responseEmbed]});
                            })
                        }
                    } else if(countryChat.isTextBased()) {
                        countryChat.send({content: responseContent, embeds: [responseEmbed]})
                    };

                    interaction.editReply({embeds: [
                        new EmbedBuilder()
                        .setColor(Colors.Green)
                        .setTitle('Carta enviada com sucesso!')
                        .setDescription(`Sua carta foi enviada para ${countryChat.name.replaceAll('-', ' ').toUpperCase()}`)
                    ]});
                } catch (error) {
                    interaction.editReply({embeds: [
                        new EmbedBuilder()
                        .setColor(Colors.Red)
                        .setTitle("Ocorreu um erro ao tentar enviar a carta.")
                        .setDescription(`${error.message || 'Erro desconhecido.'}`)
                    ]});
                }
            }
        });
    },

    /**
     * @param {AutocompleteInteraction} interaction
     */
    async autocomplete(interaction) {
        const serverConfig = Server.config(interaction.guildId);
        const focusedOption = interaction.options.getFocused(true);
        const countryCategory = interaction.guild.channels.cache.get((await serverConfig)?.server?.channels?.country_category);
        if(!countryCategory || countryCategory.type != ChannelType.GuildCategory) return;

        let choices;

        switch (focusedOption.name) {
            case 'destinatário':
                choices = countryCategory.children.cache.map(c => c.name);
                break;
        
            default:
                break;
        }

        const filtered = choices.filter(choice => choice.includes(focusedOption.value.toLowerCase().replaceAll(' ', '-'))).slice(0, 25);
        await interaction.respond(
            filtered.sort().map(choice => ({ name: choice, value: choice })),
        );
    }
}