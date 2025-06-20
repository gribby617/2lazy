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
    }
  },

  pope:(victim, param)=>{
    if(victim.level<2) return;
    victim.public.color = "pope";
    victim.room.emit("update",{guid:victim.public.guid,userPublic:victim.public})
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
        this.public = {};
        this.slowed = false; //This checks if the client is slowed
        this.sanitize = true;
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
