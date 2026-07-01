import { 
    SlashCommandBuilder, 
    SlashCommandStringOption, 
    Colors, 
    EmbedBuilder, 
    PermissionsBitField,
    ChatInputCommandInteraction,
    SlashCommandAttachmentOption
} from "discord.js";
import botConfig from "../../config.json" with { type: "json" };
import * as Server from "../../src/Server.js";
import 'dotenv/config';
import { getAllPlayers, getContext, getCurrentDate, getWars } from "../../src/Roleplay.js";
import { aiGenerate } from "../../src/AIUtils.js";
import { chunkifyText } from "../../src/StringUtils.js";

export default {
    data: new SlashCommandBuilder()
        .setName("palpite")
        .setDescription(`[Administrativo] Peça palpites do roleplay ao ${botConfig.name}.`)
        .addStringOption(
            new SlashCommandStringOption()
            .setName("prompt")
            .setDescription("O que será perguntado")
            .setRequired(true)
        )
        .addAttachmentOption(
            new SlashCommandAttachmentOption()
            .setName('imagem')
            .setDescription('Adicione uma imagem para analisar')
            .setRequired(false)
        ),

    min_tier: 2,
    
    /**
     * @param {ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {

        const serverConfig = await Server.config(interaction.guildId);

        if(!serverConfig) return interaction.editReply({
            content: `Esse servidor não está configurado corretamente. Contate um administrador.`
        });

        if(serverConfig?.server_tier<2) return interaction.editReply({content: `Essa funcionalidade não está disponível no plano atual do servidor (${botConfig.plans[serverConfig?.server_tier]}). Faça o upgrade para o plano ${botConfig.plans[2]} para liberá-la.`});

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.editReply({
            content: "Este comando é apenas para administradores."
        });

        interaction.editReply({
            content: '-# Um segundo. Estou pensando...'
        }).then(async () => {
            const palpiteUser = interaction.member.displayName;
            const palpiteGuildName = interaction.guild.name;
            const palpitePrompt = interaction.options.get("prompt").value;
            const palpiteChatHistory = (await interaction.channel.messages?.fetch()).sort((a, b) => a.createdTimestamp - b.createdTimestamp).map(m => `-- ${m.member?.displayName || m.author?.displayName} (ID ${m.author.id}) às ${new Date(m.createdTimestamp).toLocaleString('pt-BR')}: ${m.cleanContent}`).join('\n\n');
            const actionContext = await getContext(interaction.guild);
            const serverRoleplayDate = await getCurrentDate(interaction.guild);
            const serverOwnedCountries = await getAllPlayers(interaction.guild);
            const serverCurrentWars = await getWars(interaction.guild);

            if(!actionContext) return interaction.editReply({embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`Algo está errado com a configuração do servidor.`)]})

            const prompt = eval("`" + process.env.PROMPT_PALPITE + "`");
            const image = interaction.options.getAttachment('imagem'); 
            const imageUrl = image?.contentType?.startsWith('image') ? image.url : undefined;

            const response = await aiGenerate(prompt, imageUrl).catch(error => {
                console.error(`-- Erro ao gerar palpite: ${error.message}`);
            });

            const responseTexts = chunkifyText(response.text);

            if(responseTexts.length > 1) {
                let lastMessage = await interaction.editReply({
                    content: responseTexts[0]
                });

                for (let i = 1; i < responseTexts.length; i++) {
                    const currentText = responseTexts[i];
                    lastMessage = await lastMessage?.reply({
                        content: currentText
                    });
                }
            } else if(responseTexts.length == 1) {
                interaction.editReply({
                    content: response.text
                }).catch((error) => {
                    console.error(`-- Não respondido devido a ${error.message}`);
                });
            }
        }).catch((error) => {
            console.error(`-- Não respondido devido a ${error.message}`);
        });
    }
};
