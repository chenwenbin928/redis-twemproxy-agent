var fs   = require('fs'),
    exec = require('child_process').exec,
    path = require('path'),
    os   = require('os');

var Sentinel   = require("node-sentinel"),
    _          = require("underscore"),
    async      = require("async"),
    nodemailer = require("nodemailer");

function Agent(config){
  if(!_.isObject(config)){
    return console.error("Bad config");
  }

  this.nutcracker_config_file = config.nutcracker_config_file;
  this.redis_sentinel_ip = config.redis_sentinel_ip;
  this.redis_sentinel_port = config.redis_sentinel_port;
  this.log = "";
}

Agent.prototype.restart_nutcracker = function(callback){
  var self = this;
  var child = exec(
    "/etc/init.d/nutcracker restart",
    function(error, stdout, stderr) {
      self.log += "<h2>Nutcracker restarted with outuput:</h2>";
      self.log += "<div><pre>"+stdout+"</pre></div>";

      if (error !== null) {
        self.log += "<h2>Nutcracker failed restarting with error:</h2>";
        self.log += "<div><pre>"+error+"</pre></div>";
      }
      return callback();
    }
  );
};

Agent.prototype.update_nutcracker_config = function(data, callback){
  var old_content = fs.readFileSync(this.nutcracker_config_file, 'utf8');

  var new_content = old_content.replace(
    data.details["old-ip"]+":"+data.details["old-port"],
    data.details["new-ip"]+":"+data.details["new-port"]
  );

  fs.writeFileSync(this.nutcracker_config_file, new_content, 'utf8');

  this.log += "<h2>Nutcracker config updated with new content:</h2>";
  this.log += "<div><pre>"+new_content+"</pre></div>";

  return callback();
};

Agent.prototype.send_mail = function() {
  var self = this;
  var transport = nodemailer.createTransport("Sendmail");

  var mailOptions = {
    from: "from@mail.com",
    to: "to@mail.com",
    subject: "Warning: Nutcracker restarted forced on "+os.hostname(),
    generateTextFromHTML: true,
    html: "<h1>Nutcracker was restarted due to master switch in redis configuration.</h1>" + this.log
  };

  transport.sendMail(mailOptions, function(error, responseStatus){
    self.log = "";
    if(error) {
      return console.error(error);
    }

    return console.info(
      responseStatus.message+"\n"+responseStatus.messageId
    );
  });
};

Agent.prototype.switch_master_handler = function(){
  var self = this;
  return function(data) {
    async.series([
                 function(callback) {
      self.update_nutcracker_config(data, callback);
    },
    function(callback) {
      self.restart_nutcracker(callback);
    }
    ],
    function(){
      return self.send_mail();
    });
  };
};

Agent.prototype.start_sentinel = function(){
  this.sentinel = new Sentinel(
    this.redis_sentinel_ip, this.redis_sentinel_port
  );

  this.sentinel.on("switch-master", this.switch_master_handler());
};

Agent.prototype.check_nutcracker_config = function(cb){
  fs.appendFile(this.nutcracker_config_file, "", cb);
};

Agent.prototype.bootstrap = function(){
  var self = this;

  this.check_nutcracker_config(
    function(error){
    if(error) {
      return console.error("Nutcracker config file: "+error);
    }

    return self.start_sentinel();
  }
  );
};

module.exports = Agent;