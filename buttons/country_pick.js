import { 
    ActionRowBuilder,
    ButtonInteraction,
    ChannelType,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} from 'discord.js';
import * as Server from '../src/Server.js';
import botConfig from '../config.json' with { type: 'json' };
const cooldownUsers = {};

export default {

    /**
     * @param {ButtonInteraction} interaction 
     */
    async execute(interaction) {

        const useCooldown = 10 * 60 * 1000;

        if(!process.env.MAINTENANCE && Object.keys(cooldownUsers).includes(interaction.user.id)) return interaction.reply({
            flags: [MessageFlags.Ephemeral],
            content: `Você só poderá usar esse botão novamente <t:${Math.floor(cooldownUsers[interaction.user.id]/1000)}:R>`
        });

        cooldownUsers[interaction.user.id] = new Date().getTime() + (useCooldown);
        setTimeout(() => {
            delete cooldownUsers[interaction.user.id];    
        }, useCooldown);

        const serverConfig = await Server.config(interaction.guildId);

        if (!serverConfig?.server?.channels?.picked_countries) return;
        if(serverConfig?.server_tier<2) return interaction.reply({content: `Essa funcionalidade não está disponível no plano atual do servidor (${botConfig.plans[serverConfig?.server_tier]}). Faça o upgrade para o plano ${botConfig.plans[2]} para liberá-la.`, flags: [MessageFlags.Ephemeral]});

        const countryCategory = await interaction.guild?.channels.fetch(serverConfig?.server?.channels?.country_category);
        if(countryCategory.type != ChannelType.GuildCategory) return interaction.reply({content: 'A categoria de países não está configurada corretamente', flags: [MessageFlags.Ephemeral]});
        const countryChannels = countryCategory.children.cache;

        let options = countryChannels.map(c => 
            new StringSelectMenuOptionBuilder()
			.setLabel(`${c.name}`)
			.setValue(`${c.id}`)
        ).sort((a, b) => a.data.label.localeCompare(b.data.label));

        options.push(
            new StringSelectMenuOptionBuilder()
            .setLabel('outro')
            .setValue('outro')
            .setDescription('Não encontrei o país que desejo nas opções.')
        )

        const maxOptions = 25;
        let selectMenus = [];

        // Divide as opções em grupos de até 25
        for (let i = 0; i < options.length; i += maxOptions) {
            selectMenus.push(
                new StringSelectMenuBuilder()
                .setCustomId(`country_pick:${i/maxOptions}`)
                .setPlaceholder(`Opções a partir de ${options[i].data.label} (alfabeticamente)`)
                .setMinValues(1)
                .setMaxValues(1)
                .setOptions(options.slice(i, i + maxOptions))
            );
        }

        interaction.reply({
            flags: [MessageFlags.Ephemeral],
            content: '## Escolha com o que vai jogar:',
            components: selectMenus.map(menu => new ActionRowBuilder().addComponents(menu))
        })

    }

}