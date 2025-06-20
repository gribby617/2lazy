var express = require("express");
var fs = require("fs");
var path = require("path");

//Read settings
var colors = fs.readFileSync("./config/colors.txt").toString().replace(/\r/,"").split("\n");
var blacklist = fs.readFileSync("./config/blacklist.txt").toString().replace(/\r/,"").split("\n");
var config = JSON.parse(fs.readFileSync("./config/config.json"));
if(blacklist.includes("")) blacklist = []; //If the blacklist has a blank line, ignore the whole list.

//Variables
var rooms = {};
var userips = {}; //It's just for the alt limit
var guidcounter = 0;
var lastMessage = { text: "", user: "" }; // Track last message for quoting
var typingUsers = {}; // Track typing status per room
var bannedUsers = {}; // Store banned users by IP address

// Express app setup
var app = express();

// Serve everything from frontend directory
app.use('/', express.static('frontend'));

// Create HTTP server
var server = require("http").createServer(app);

//Socket.io Server
var io = require("socket.io")(server, {
    allowEIO3: true
});

server.listen(config.port, () => {
    rooms["default"] = new room("default");
    console.log("running at http://bonzi.localhost:" + config.port);
});
io.on("connection", (socket) => {
  // Check if user is banned
  var userIP = socket.request.connection.remoteAddress;
  if(bannedUsers[userIP] && bannedUsers[userIP].end > Date.now()) {
    // User is still banned
    socket.emit("ban", {
      reason: bannedUsers[userIP].reason,
      end: bannedUsers[userIP].end
    });
    socket.disconnect();
    return;
  } else if(bannedUsers[userIP] && bannedUsers[userIP].end <= Date.now()) {
    // Ban has expired, remove it
    delete bannedUsers[userIP];
  }
  
  //First, verify this user fits the alt limit
  if(typeof userips[socket.request.connection.remoteAddress] == 'undefined') userips[socket.request.connection.remoteAddress] = 0;
  userips[socket.request.connection.remoteAddress]++;
  
  if(userips[socket.request.connection.remoteAddress] > config.altlimit){
    //If we have more than the altlimit, don't accept this connection and decrement the counter.
    userips[socket.request.connection.remoteAddress]--;
    socket.disconnect();
    return;
  }
  
  //Set up a new user on connection
    new user(socket);
});

//Markdown processing function
function processMarkdown(text) {
  // Bold: **text**
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Italics: ~~text~~
  text = text.replace(/~~(.*?)~~/g, '<em>$1</em>');
  
  // Underline: __text__
  text = text.replace(/__(.*?)__/g, '<u>$1</u>');
  
  // Strikethrough: --text--
  text = text.replace(/--(.*?)--/g, '<s>$1</s>');
  
  // Big: ^^text^^
  text = text.replace(/\^\^(.*?)\^\^/g, '<big>$1</big>');
  
  // Rainbow: $r$text$r$
  text = text.replace(/\$r\$(.*?)\$r\$/g, function(match, p1) {
    const colors = ["#ff0000", "#ff9900", "#ffee00", "#33ff00", "#00cfff", "#3300ff", "#cc00ff"];
    let out = "";
    let colorIndex = 0;
    for (let i = 0; i < p1.length; i++) {
        const char = p1[i];
        if (char !== " ") {
            out += `<span style="color: ${colors[colorIndex % colors.length]};">${char}</span>`;
            colorIndex++;
        } else {
            out += " ";
        }
    }
    return out;
  });
  
  // Spoilers: ||text||
  text = text.replace(/\|\|(.*?)\|\|/g, '<span class="spoiler">$1</span>');
  
  // Code: ``text``
  text = text.replace(/``(.*?)``/g, '<code>$1</code>');
  
  return text;
}

//Now for the fun!

//Command list
var commands = {

  name:(victim,param)=>{
    if (param == "" || param.length > config.namelimit) return;
    // Apply markdown formatting to names
    victim.public.name = processMarkdown(param);
    victim.room.emit("update",{guid:victim.public.guid,userPublic:victim.public})
  },
  
  asshole:(victim,param)=>{
  victim.room.emit("asshole",{
    guid:victim.public.guid,
    target:param,
  })
  },
    
  color:(victim, param)=>{
    param = param.toLowerCase();
    if(!colors.includes(param)) param = colors[Math.floor(Math.random() * colors.length)];
    victim.public.color = param;
    victim.room.emit("update",{guid:victim.public.guid,userPublic:victim.public})
  }, 
  
  pitch:(victim, param)=>{
    param = parseInt(param);
    if(isNaN(param)) return;
    victim.public.pitch = param;
    victim.room.emit("update",{guid:victim.public.guid,userPublic:victim.public})
  },

  speed:(victim, param)=>{
    param = parseInt(param);
    if(isNaN(param) || param>400) return;
    victim.public.speed = param;
    victim.room.emit("update",{guid:victim.public.guid,userPublic:victim.public})
  },
  
  godmode:(victim, param)=>{
    if(param == config.godword) {
      victim.level = 2;
      // Notify frontend of level change
      victim.socket.emit("levelUpdate", { level: victim.level });
    }
  },

  kingmode:(victim, param)=>{
    if(param == config.kingword) {
      victim.level = 1;
      // Notify frontend of level change
      victim.socket.emit("levelUpdate", { level: victim.level });
    }
  },

  pope:(victim, param)=>{
    if(victim.level<2) return;
    victim.public.color = "pope";
    victim.room.emit("update",{guid:victim.public.guid,userPublic:victim.public})
  },

  king:(victim, param)=>{
    if(victim.level<1) return;
    victim.public.color = "king";
    victim.room.emit("update",{guid:victim.public.guid,userPublic:victim.public})
  },

  tempban:(victim, param)=>{
    if(victim.level<1) return;
    
    // Parse username and reason from parameter
    var spaceIndex = param.indexOf(" ");
    var targetUsername = param;
    var reason = "A king got pissed.";
    
    if(spaceIndex !== -1) {
      targetUsername = param.substring(0, spaceIndex);
      reason = param.substring(spaceIndex + 1);
    }
    
    // Find target user by name
    var targetUser = null;
    for(var guid in victim.room.usersPublic) {
      if(victim.room.usersPublic[guid].name.replace(/<[^>]*>/g, "") === targetUsername) {
        targetUser = victim.room.users.find(u => u.public.guid == guid);
        break;
      }
    }
    if(!targetUser) return;
    
    // Store ban in bannedUsers
    var banEnd = Date.now() + (10 * 60 * 1000); // 10 minutes
    bannedUsers[targetUser.socket.request.connection.remoteAddress] = {
      reason: reason,
      end: banEnd
    };
    
    // Temp ban for 10 minutes
    targetUser.socket.emit("ban", {
      reason: reason,
      end: banEnd
    });
    
    // Remove user from room
    delete victim.room.usersPublic[targetUser.public.guid];
    victim.room.emit("leave", { guid: targetUser.public.guid });
    victim.room.users.splice(victim.room.users.indexOf(targetUser), 1);
    targetUser.socket.disconnect();
  },

  kick:(victim, param)=>{
    if(victim.level<1) return;
    
    // Parse username and reason from parameter
    var spaceIndex = param.indexOf(" ");
    var targetUsername = param;
    var reason = "A king got pissed.";
    
    if(spaceIndex !== -1) {
      targetUsername = param.substring(0, spaceIndex);
      reason = param.substring(spaceIndex + 1);
    }
    
    // Find target user by name
    var targetUser = null;
    for(var guid in victim.room.usersPublic) {
      if(victim.room.usersPublic[guid].name.replace(/<[^>]*>/g, "") === targetUsername) {
        targetUser = victim.room.users.find(u => u.public.guid == guid);
        break;
      }
    }
    if(!targetUser) return;
    
    // Kick user
    targetUser.socket.emit("kick", {
      reason: reason
    });
    
    // Remove user from room
    delete victim.room.usersPublic[targetUser.public.guid];
    victim.room.emit("leave", { guid: targetUser.public.guid });
    victim.room.users.splice(victim.room.users.indexOf(targetUser), 1);
    targetUser.socket.disconnect();
  },

  ban:(victim, param)=>{
    if(victim.level<2) return;
    
    // Parse username and reason from parameter
    var spaceIndex = param.indexOf(" ");
    var targetUsername = param;
    var reason = "Banned by pope.";
    
    if(spaceIndex !== -1) {
      targetUsername = param.substring(0, spaceIndex);
      reason = param.substring(spaceIndex + 1);
    }
    
    // Find target user by name
    var targetUser = null;
    for(var guid in victim.room.usersPublic) {
      if(victim.room.usersPublic[guid].name.replace(/<[^>]*>/g, "") === targetUsername) {
        targetUser = victim.room.users.find(u => u.public.guid == guid);
        break;
      }
    }
    if(!targetUser) return;
    
    // Store ban in bannedUsers
    var banEnd = Date.now() + (365 * 24 * 60 * 60 * 1000); // 1 year ban
    bannedUsers[targetUser.socket.request.connection.remoteAddress] = {
      reason: reason,
      end: banEnd
    };
    
    // Ban user permanently
    targetUser.socket.emit("ban", {
      reason: reason,
      end: banEnd
    });
    
    // Remove user from room
    delete victim.room.usersPublic[targetUser.public.guid];
    victim.room.emit("leave", { guid: targetUser.public.guid });
    victim.room.users.splice(victim.room.users.indexOf(targetUser), 1);
    targetUser.socket.disconnect();
  },

  bless:(victim, param)=>{
    if(victim.level<1) return;
    
    // Parse username from parameter
    var targetUsername = param;
    
    // Find target user by name
    var targetUser = null;
    for(var guid in victim.room.usersPublic) {
      if(victim.room.usersPublic[guid].name.replace(/<[^>]*>/g, "") === targetUsername) {
        targetUser = victim.room.users.find(u => u.public.guid == guid);
        break;
      }
    }
    if(!targetUser) return;
    
    // Set user as blessed (VIP status)
    targetUser.blessed = true;
    targetUser.public.blessed = true;
    targetUser.public.color = "blessed"; // Set blessed color
    
    // Update the user's character limit
    targetUser.charLimit = config.charlimit * 2; // Double character limit for blessed users
    
    // Notify the blessed user
    targetUser.socket.emit("blessed", { 
      message: "You have been blessed! You now have VIP status with higher character limits and voteban access.",
      charLimit: targetUser.charLimit
    });
    
    // Update the user in the room
    victim.room.emit("update", { guid: targetUser.public.guid, userPublic: targetUser.public });
    
    // Notify the blesser
    victim.socket.emit("blessed", { 
      message: targetUsername + " has been blessed with VIP status!",
      charLimit: targetUser.charLimit
    });
  },

  voteban:(victim, param)=>{
    if(!victim.blessed && victim.level<1) return; // Only blessed users or kings/popes can voteban
    
    // Parse username from parameter
    var targetUsername = param;
    console.log("Voteban initiated by", victim.public.name, "against", targetUsername);
    
    // Find target user by name
    var targetUser = null;
    for(var guid in victim.room.usersPublic) {
      var cleanName = victim.room.usersPublic[guid].name.replace(/<[^>]*>/g, "");
      console.log("Checking user:", cleanName, "against target:", targetUsername);
      if(cleanName === targetUsername) {
        targetUser = victim.room.users.find(u => u.public.guid == guid);
        console.log("Found target user:", targetUser.public.name);
        break;
      }
    }
    if(!targetUser) {
      console.log("Target user not found:", targetUsername);
      return;
    }
    
    // Start voteban process
    var votebanId = Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    var votes = {};
    var requiredVotes = Math.max(2, Math.floor(Object.keys(victim.room.usersPublic).length * 0.3)); // 30% of room or minimum 2
    
    // Store voteban data
    victim.room.votebans = victim.room.votebans || {};
    victim.room.votebans[votebanId] = {
      target: targetUser,
      targetUsername: targetUsername,
      initiator: victim,
      votes: votes,
      requiredVotes: requiredVotes,
      startTime: Date.now(),
      duration: 30000 // 30 seconds to vote
    };
    
    console.log("Voteban stored with target:", victim.room.votebans[votebanId].target.public.name);
    
    // Notify all users in the room about the voteban
    victim.room.emit("votebanStart", {
      votebanId: votebanId,
      targetUsername: targetUsername,
      initiatorName: victim.public.name,
      requiredVotes: requiredVotes,
      duration: 30000
    });
    
    // Set timer to end voteban
    setTimeout(() => {
      if(victim.room.votebans && victim.room.votebans[votebanId]) {
        var voteban = victim.room.votebans[votebanId];
        var voteCount = Object.keys(voteban.votes).length;
        
        if(voteCount >= voteban.requiredVotes) {
          console.log("Voteban successful! Banning target:", voteban.target.public.name);
          
          // Store ban in bannedUsers
          var banEnd = Date.now() + (60 * 1000); // 1 minute ban
          bannedUsers[voteban.target.socket.request.connection.remoteAddress] = {
            reason: "Everyone thought you were Megaman",
            end: banEnd
          };
          
          // Voteban successful - ban the target
          voteban.target.socket.emit("ban", {
            reason: "Everyone thought you were Megaman",
            end: banEnd
          });
          
          // Remove user from room
          delete victim.room.usersPublic[voteban.target.public.guid];
          victim.room.emit("leave", { guid: voteban.target.public.guid });
          victim.room.users.splice(victim.room.users.indexOf(voteban.target), 1);
          voteban.target.socket.disconnect();
          
          // Notify room of successful voteban
          victim.room.emit("votebanResult", {
            votebanId: votebanId,
            targetUsername: targetUsername,
            success: true,
            voteCount: voteCount,
            requiredVotes: voteban.requiredVotes
          });
        } else {
          // Voteban failed
          victim.room.emit("votebanResult", {
            votebanId: votebanId,
            targetUsername: targetUsername,
            success: false,
            voteCount: voteCount,
            requiredVotes: voteban.requiredVotes
          });
        }
        
        // Clean up voteban data
        delete victim.room.votebans[votebanId];
      }
    }, 30000);
  },

  vote:(victim, param)=>{
    // Parse votebanId from parameter
    var votebanId = param;
    
    // Check if there's an active voteban
    if(!victim.room.votebans || !victim.room.votebans[votebanId]) {
      victim.socket.emit("voteError", { message: "No active voteban found." });
      return;
    }
    
    var voteban = victim.room.votebans[votebanId];
    console.log("Vote cast by", victim.public.name, "for voteban", votebanId);
    console.log("Voteban target:", voteban.target.public.name);
    
    // Check if user already voted
    if(voteban.votes[victim.public.guid]) {
      victim.socket.emit("voteError", { message: "You have already voted on this voteban." });
      return;
    }
    
    // Check if voteban is still active (within 30 seconds)
    if(Date.now() - voteban.startTime > 30000) {
      victim.socket.emit("voteError", { message: "Voteban has expired." });
      return;
    }
    
    // Add vote
    voteban.votes[victim.public.guid] = true;
    
    // Notify room of vote
    victim.room.emit("voteCast", {
      votebanId: votebanId,
      voterName: victim.public.name,
      currentVotes: Object.keys(voteban.votes).length,
      requiredVotes: voteban.requiredVotes
    });
    
    // Check if voteban should end early
    if(Object.keys(voteban.votes).length >= voteban.requiredVotes) {
      console.log("Voteban successful! Banning target:", voteban.target.public.name);
      
      // Store ban in bannedUsers
      var banEnd = Date.now() + (60 * 1000); // 1 minute ban
      bannedUsers[voteban.target.socket.request.connection.remoteAddress] = {
        reason: "Everyone thought you were Megaman",
        end: banEnd
      };
      
      // Voteban successful - ban the target
      voteban.target.socket.emit("ban", {
        reason: "Everyone thought you were Megaman",
        end: banEnd
      });
      
      // Remove user from room
      delete victim.room.usersPublic[voteban.target.public.guid];
      victim.room.emit("leave", { guid: voteban.target.public.guid });
      victim.room.users.splice(victim.room.users.indexOf(voteban.target), 1);
      voteban.target.socket.disconnect();
      
      // Notify room of successful voteban
      victim.room.emit("votebanResult", {
        votebanId: votebanId,
        targetUsername: voteban.targetUsername,
        success: true,
        voteCount: Object.keys(voteban.votes).length,
        requiredVotes: voteban.requiredVotes
      });
      
      // Clean up voteban data
      delete victim.room.votebans[votebanId];
    }
  },

  restart:(victim, param)=>{
    if(victim.level<2) return;
    process.exit();
  },

  update:(victim, param)=>{
    if(victim.level<2) return;
    //Just re-read the settings.
    colors = fs.readFileSync("./config/colors.txt").toString().replace(/\r/,"").split("\n");
blacklist = fs.readFileSync("./config/blacklist.txt").toString().replace(/\r/,"").split("\n");
config = JSON.parse(fs.readFileSync("./config/config.json"));
if(blacklist.includes("")) blacklist = []; 
  },
  
  joke:(victim, param)=>{
    victim.room.emit("joke", {guid:victim.public.guid, rng:Math.random()})
  },
  
  fact:(victim, param)=>{
    victim.room.emit("fact", {guid:victim.public.guid, rng:Math.random()})
  },
  
  backflip:(victim, param)=>{
    victim.room.emit("backflip", {guid:victim.public.guid, swag:(param.toLowerCase() == "swag")})
  },
  
  owo:(victim, param)=>{
  victim.room.emit("owo",{
    guid:victim.public.guid,
    target:param,
  })
  },
  
  sanitize:(victim, param)=>{
    if(victim.level<2) return;
    if(victim.sanitize) victim.sanitize = false;
    else victim.sanitize = true;
  },

  triggered:(victim, param)=>{
    victim.room.emit("triggered", {guid:victim.public.guid})
  },

  linux:(victim, param)=>{
    victim.room.emit("linux", {guid:victim.public.guid})
  },

  youtube:(victim, param)=>{
    victim.room.emit("youtube",{guid:victim.public.guid, vid:param.replace(/"/g, "&quot;")})
  },

  image:(victim, param)=>{
    if(param == "") return;
    // Validate catbox URL format
    if(!param.includes("files.catbox.moe/")) return;
    victim.room.emit("image", {guid:victim.public.guid, url:param.replace(/"/g, "&quot;")})
  },

  video:(victim, param)=>{
    if(param == "") return;
    // Validate catbox URL format
    if(!param.includes("files.catbox.moe/")) return;
    victim.room.emit("video", {guid:victim.public.guid, url:param.replace(/"/g, "&quot;")})
  },

  quote:(victim, param)=>{
    if(lastMessage.text == "") {
      // Send a message to the user that there's nothing to quote
      victim.socket.emit("quoteError", {message: "No message to quote!"});
      return;
    }
    victim.room.emit("quote", {guid:victim.public.guid, quotedText: lastMessage.text, quotedUser: lastMessage.user})
  },

  dm:(victim, param)=>{
    if(param == "") return;
    
    // Parse username and message from parameter
    var spaceIndex = param.indexOf(" ");
    if(spaceIndex === -1) return; // No space found, invalid format
    
    var targetUsername = param.substring(0, spaceIndex);
    var message = param.substring(spaceIndex + 1);
    
    if(message == "") return; // No message provided
    
    // Find target user by name
    var targetUser = null;
    for(var guid in victim.room.usersPublic) {
      if(victim.room.usersPublic[guid].name.replace(/<[^>]*>/g, "") === targetUsername) {
        targetUser = victim.room.users.find(u => u.public.guid == guid);
        break;
      }
    }
    if(!targetUser) return;
    
    // Send DM to target user
    targetUser.socket.emit("dm", {
      from: victim.public.name,
      fromGuid: victim.public.guid,
      message: message
    });
    
    // Send confirmation to sender
    victim.socket.emit("dmSent", {to: targetUsername});
  },

}

//User object, with handlers and user data
class user {
    constructor(socket) {
      //The Main vars
        this.socket = socket;
        this.loggedin = false;
        this.level = 0; //This is the authority level
        this.blessed = false; //Blessed VIP status
        this.public = {};
        this.slowed = false; //This checks if the client is slowed
        this.sanitize = true;
        this.charLimit = config.charlimit; //Character limit (doubled for blessed users)
        this.socket.on("login", (logdata) => {
          if(typeof logdata !== "object" || typeof logdata.name !== "string" || typeof logdata.room !== "string") return;
          //Filter the login data
            if (logdata.name == undefined || logdata.room == undefined) logdata = { room: "default", name: "Anonymous" };
          (logdata.name == "" || logdata.name.length > config.namelimit || filtertext(logdata.name)) && (logdata.name = "Anonymous");
          logdata.name.replace(/ /g,"") == "" && (logdata.name = "Anonymous");
            if (this.loggedin == false) {
              //If not logged in, set up everything
                this.loggedin = true;
                this.public.name = processMarkdown(logdata.name);
                this.public.color = colors[Math.floor(Math.random()*colors.length)];
                this.public.pitch = 100;
                this.public.speed = 100;
                guidcounter++;
                this.public.guid = guidcounter;
                var roomname = logdata.room;
                if(roomname == "") roomname = "default";
                if(rooms[roomname] == undefined) rooms[roomname] = new room(roomname);
                this.room = rooms[roomname];
                this.room.users.push(this);
                this.room.usersPublic[this.public.guid] = this.public;
              //Update the new room
                this.socket.emit("updateAll", { usersPublic: this.room.usersPublic });
                this.room.emit("update", { guid: this.public.guid, userPublic: this.public }, this);
            }
          //Send room info
          this.socket.emit("room",{
            room:this.room.name,
            isOwner:false,
            isPublic:this.room.name == "default",
            userLevel: this.level
          })
        });
      
      //typing events
      this.socket.on("typingStart", () => {
        console.log("typingStart received from user:", this.public.name);
        if(!this.loggedin) return;
        
        // Initialize typing users for this room if it doesn't exist
        if(!typingUsers[this.room.name]) {
          typingUsers[this.room.name] = {};
        }
        
        // Add user to typing list
        typingUsers[this.room.name][this.public.guid] = true;
        console.log("typingUsers for room", this.room.name, ":", typingUsers[this.room.name]);
        
        // Emit typing status to all users in room
        this.room.emit("typingUpdate", { 
          typingUsers: Object.keys(typingUsers[this.room.name]),
          room: this.room.name 
        });
      });
      
      this.socket.on("typingStop", () => {
        console.log("typingStop received from user:", this.public.name);
        if(!this.loggedin) return;
        
        // Remove user from typing list
        if(typingUsers[this.room.name] && typingUsers[this.room.name][this.public.guid]) {
          delete typingUsers[this.room.name][this.public.guid];
          console.log("typingUsers for room", this.room.name, "after stop:", typingUsers[this.room.name]);
          
          // Emit updated typing status
          this.room.emit("typingUpdate", { 
            typingUsers: Object.keys(typingUsers[this.room.name]),
            room: this.room.name 
          });
        }
      });

      //talk
        this.socket.on("talk", (msg) => {
          if(typeof msg !== "object" || typeof msg.text !== "string") return;
          
          // Check character limit
          if(msg.text.length > this.charLimit) {
            this.socket.emit("charLimitError", { 
              message: "Message too long! Limit: " + this.charLimit + " characters. Your message: " + msg.text.length + " characters.",
              limit: this.charLimit,
              current: msg.text.length
            });
            return;
          }
          
          //filter
          if(filtertext(msg.text) && this.sanitize) msg.text = "RAPED AND ABUSED";
          
          // Store original text for TTS before markdown processing
          var originalText = msg.text;
          
          // Apply markdown formatting
          msg.text = processMarkdown(msg.text);
          
          //talk
            if(!this.slowed){
              this.room.emit("talk", { guid: this.public.guid, text: msg.text, originalText: originalText });
              
              // Store last message for quoting
              lastMessage.text = originalText;
              lastMessage.user = this.public.name;
              
              // Stop typing when message is sent
              if(typingUsers[this.room.name] && typingUsers[this.room.name][this.public.guid]) {
                delete typingUsers[this.room.name][this.public.guid];
                this.room.emit("typingUpdate", { 
                  typingUsers: Object.keys(typingUsers[this.room.name]),
                  room: this.room.name 
                });
              }
              
        this.slowed = true;
        setTimeout(()=>{
          this.slowed = false;
        },config.slowmode)
            }
        });

      //Deconstruct the user on disconnect
        this.socket.on("disconnect", () => {
          userips[this.socket.request.connection.remoteAddress]--;
          if(userips[this.socket.request.connection.remoteAddress] == 0) delete userips[this.socket.request.connection.remoteAddress];
                                                                  
          

            if (this.loggedin) {
                delete this.room.usersPublic[this.public.guid];
                this.room.emit("leave", { guid: this.public.guid });
this.room.users.splice(this.room.users.indexOf(this), 1);
            }
        });

      //COMMAND HANDLER
      this.socket.on("command",cmd=>{
        //parse and check
        if(cmd.list[0] == undefined) return;
        var comd = cmd.list[0];
        var param = ""
        if(cmd.list[1] == undefined) param = ""
        else{
        param=cmd.list;
        param.splice(0,1);
        param = param.join(" ");
        }
          //filter
          if(typeof param !== 'string') return;
          if(this.sanitize) param = param.replace(/</g, "&lt;").replace(/>/g, "&gt;");
          if(filtertext(param) && this.sanitize) return;
          // Strip HTML tags from command parameters
          param = param.replace(/<[^>]*>/g, "");
        //carry it out
        if(!this.slowed){
          if(commands[comd] !== undefined) commands[comd](this, param);
        //Slowmode
        this.slowed = true;
        setTimeout(()=>{
          this.slowed = false;
        },config.slowmode)
        }
      })
    }
}

//Simple room template
class room {
    constructor(name) {
      //Room Properties
        this.name = name;
        this.users = [];
        this.usersPublic = {};
    }

  //Function to emit to every room member
    emit(event, msg, sender) {
        this.users.forEach((user) => {
            if(user !== sender)  user.socket.emit(event, msg)
        });
    }
}

//Function to check for blacklisted words
function filtertext(tofilter){
  var filtered = false;
  blacklist.forEach(listitem=>{
    if(tofilter.includes(listitem)) filtered = true;
  })
  return filtered;
}
