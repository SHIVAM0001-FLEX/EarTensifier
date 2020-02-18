const fs = require("fs");
const Discord = require("discord.js");
const cooldowns = new Discord.Collection();
const Event = require('../Event');

const users = require("../models/user.js")
const servers = require("../models/server.js");
const bot = require("../models/bot.js");
const commandsSchema = require("../models/command.js");

const mongoose = require("mongoose");
const { mongoUsername, mongoPass } = require("../tokens.json");
mongoose.connect(`mongodb+srv://${mongoUsername}:${mongoPass}@tetracyl-unhxi.mongodb.net/test?retryWrites=true&w=majority`, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

module.exports = class Message extends Event {
  constructor(...args) {
    super(...args)
  }

  async run(message) {
    if (message.author.bot) return;
    if (message.channel.type === "text") {
      if (!message.channel.permissionsFor(message.guild.me).missing("SEND_MESSAGES")) return;
    }

    if (!message.channel.guild) return message.channel.send("I can't execute commands inside DMs! Please run this command in a server.");

    const mentionPrefix = new RegExp(`^<@!?${this.client.user.id}>( |)$`);
    let prefix;
    let ignoreMsg;
    //const prefix = this.client.settings.prefix;
    servers.findOne({
      serverID: message.guild.id,
    }, async (err, s) => {
      if (err) console.log(err);
      if (!s) {
        const newServer = new servers({
          serverID: message.guild.id,
          serverName: message.guild.name,
          prefix: this.client.settings.prefix,
          ignore: [],
        });
        await newServer.save().catch(e => console.log(e));
        prefix = message.content.match(mentionPrefix) ? message.content.match(mentionPrefix)[0] : this.client.settings.prefix;
        ignoreMsg = false;
      } else {
        prefix = message.content.match(mentionPrefix) ? message.content.match(mentionPrefix)[0] : s.prefix;
        if (s.ignore.includes(message.channel.id)) ignoreMsg = true;
      }

      if (ignoreMsg) return;

      if (message.content.toLowerCase().indexOf(prefix) !== 0) return;
      const args = message.content.slice(prefix.length).trim().split(/ +/g);

      users.findOne({
        authorID: message.author.id
      }, async (err, u) => {
        if (err) console.log(err);
        if (!u) {
          const newUser = new users({
            authorID: message.author.id,
            authorName: message.author.tag,
            bio: "",
            songsPlayed: 0,
            commandsUsed: 1,
            blocked: false,
            supporter: false,
            mod: false,
            developer: false,
          });
          newUser.save().catch(e => console.log(e));
        } else {
          if (u.blocked == null) u.blocked = false;
          if (u.blocked) {
            ignoreMsg = true;
          } else if (!u.blocked) {
            u.commandsUsed += 1;
          }
        }

        if (ignoreMsg) return;

        const command = args.shift().toLowerCase();
        const cmd = this.client.commands.get(command) || this.client.commands.find(c => c.aliases && c.aliases.includes(command));
        if (!cmd) {
          if (fs.existsSync(`./commands/${command}.js`)) {
            try {
              const commandFile = require(`./commands/${command}.js`);
              if (commandFile) commandFile.run(this.client, message, args);
            } catch (error) {
              console.error(error);
              message.reply("There was an error trying to execute that command!");
            }
          }
          return;
        }

        bot.findOne({
          clientID: this.client.user.id
        }, async (err, b) => {
          if (err) console.log(err);
          if (!b) {
            const newClient = new bot({
              clientID: this.client.user.id,
              clientName: this.client.user.name,
              messagesSent: 612134,
              songsPlayed: 392678,
            });
            await newClient.save().catch(e => console.log(e));
          }

          b.messagesSent += 1;
          await b.save().catch(e => console.log(e));
        });

        commandsSchema.findOne({
          commandName: cmd.name
        }, async (err, c) => {
          if (err) console.log(err);
          if (!c) {
            const newCommand = new commandsSchema({
              commandName: cmd.name,
              timesUsed: 1,
            });
            await newCommand.save().catch(e => console.log(e));
          }

          c.timesUsed += 1;
          await c.save().catch(e => console.log(e));
        });

        console.log(`${cmd.name} used by ${message.author.tag} (${message.author.id}) from ${message.guild.name} (${message.guild.id})`)

        if (!cooldowns.has(command.name)) {
          cooldowns.set(command.name, new Discord.Collection());
        }
        if (cmd.permission === "dev" && !this.client.settings.devs.includes(message.author.id)) return this.client.responses("noPerms", message);

        if (cmd && !message.guild && cmd.guildOnly) return message.channel.send("I can't execute that command inside DMs!. Please run this command in a server.");

        if (!cooldowns.has(command.name)) {
          cooldowns.set(command.name, new Discord.Collection());
        }

        const now = Date.now();
        const timestamps = cooldowns.get(command.name);
        const cooldownAmount = cmd.cooldown * 100;

        //if (!mods.includes(message.author.id)) {
        if (!timestamps.has(message.author.id)) {
          timestamps.set(message.author.id, now);
          setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);
        }
        else {
          const expirationTime = timestamps.get(message.author.id) + cooldownAmount;
          if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            return message.reply(`Please wait ${timeLeft.toFixed(1)} more second(s) before reusing the \`${cmd.name}\` command.`);
          }
          timestamps.set(message.author.id, now);
          setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);
        }

        if (cmd && !args.length && cmd.args === true) return message.channel.send(`You didn't provide any arguments ${message.author}.\nCorrect Usage: \`${prefix}${cmd.name} ${cmd.usage}\``);

        try {
          cmd.execute(this.client, message, args);
        } catch (e) {
          console.error(e);
          message.reply("There was an error trying to execute that command!");
        }
      });
    });
  }
}