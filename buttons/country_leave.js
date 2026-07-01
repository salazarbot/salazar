import { 
    ButtonInteraction,
    MessageFlags,
} from 'discord.js';
import * as Server from '../src/Server.js';
import { simplifyString } from '../src/StringUtils.js';
import botConfig from '../config.json' with { type: "json" };

const cooldownUsers = {};

export default {

    /**
     * @param {ButtonInteraction} interaction 
     */
    async execute(interaction) {

        const serverConfig = await Server.config(interaction.guildId);

        if (!serverConfig?.server?.channels?.picked_countries) return;
        if(serverConfig?.server_tier<2) return interaction.reply({content: `Essa funcionalidade não está disponível no plano atual do servidor (${botConfig.plans[serverConfig?.server_tier]}). Faça o upgrade para o plano ${botConfig.plans[2]} para liberá-la.`, flags: [MessageFlags.Ephemeral]});

        const memberCountry = interaction.member.roles.cache.find(r => interaction.guild.channels.cache.find(c => c.parentId == serverConfig?.server?.channels?.country_category && simplifyString(r.name).includes(simplifyString(c.name))));

        try {

            const pickedCountriesChannel = await interaction.guild.channels.fetch(serverConfig.server.channels.picked_countries).catch(() => null);
            if (!pickedCountriesChannel || !pickedCountriesChannel.isTextBased()) return;

            const msgs = await pickedCountriesChannel.messages.fetch({ limit: 100 });
            for (const msg of msgs.values()) {
                if (!msg.editable) continue;
                if (msg.content.includes(`<@${interaction.member.id}>`)) {
                    await interaction.member.roles.remove(serverConfig?.server?.roles?.player);
                    await interaction.reply({content: 'Você deixou o seu país com sucesso. Se quiser pegar outro, ou ficar apenas espectando, a escolha é sua.', flags: [MessageFlags.Ephemeral]})
                    
                    if(memberCountry) interaction.member.roles.remove(memberCountry);

                    const lines = msg.content.split('\n');
                    const newLines = lines.filter(line => !line.includes(`<@${interaction.member.id}>`) || line.startsWith('##'));
                    if (newLines.length <= 1) {
                        await msg.delete().catch(() => {});
                    } else {
                        await msg.edit(newLines.join('\n')).catch(() => {});
                    }
                }
            }
        } catch (err) {
            console.error('Erro ao remover player da lista de país ao sair:', err);
        } finally {
            if(!interaction.replied) await interaction.reply({content: 'Não achei nenhum país associado ao seu nome. Nada mudou', flags: [MessageFlags.Ephemeral]})
        }

    }

}