/**
 * Module dependencies.
 */
var jwt = require('jsonwebtoken');
var config = require('../../config/config');
var mongoose = require('mongoose');
var User = mongoose.model('User');
var avatars = require('./avatars').all();

// set up jwt
var generateToken = function(user) {
        console.log(user);
        return jwt.sign(user, config.secret, {
            expiresIn: 60 * 60 * 24 // in seconds
        });
    }
    /**
     * Auth callback
     */
exports.authCallback = function(req, res, next) {
    res.redirect('/chooseavatars');
};

/**
 * Show login form
 */
exports.signin = function(req, res) {
    if (!req.user) {
        res.redirect('/#!/signin?error=invalid');
    } else {
        res.redirect('/#!/app');
    }
};

exports.login = function(req, res) {
    if (req.body.email && req.body.password) {
        User.findOne({
            email: req.body.email
        }, function(err, user) {
            if (err) {
                return res.send({
                    msg: 'An error occured'
                });
            }
            if (!user) {
                return res.send({
                    message: 'Unknown user'
                });
            }
            if (!user.authenticate(req.body.password)) {
                return res.send({
                    message: 'Invalid password'
                });
            }
            //user.email = null;
            user.hashed_password = null;

            var userInfo = {
                email: req.body.email
            };
            res.status(200).json({
                token: generateToken(userInfo),
                user: userInfo
            })
        });
    }
}

/**
 * Show sign up form
 */
exports.signup = function(req, res) {
    if (!req.user) {
        console.log('Hey');
        res.redirect('/#!/signup');
    } else {
        res.redirect('/#!/app');
    }
};

/**
 * Logout
 */
exports.signout = function(req, res) {
    req.logout();
    res.redirect('/');
};

/**
 * Session
 */
exports.session = function(req, res) {
    res.redirect('/');
};

/**
 * Check avatar - Confirm if the user who logged in via passport
 * already has an avatar. If they don't have one, redirect them
 * to our Choose an Avatar page.
 */
exports.checkAvatar = function(req, res) {
    if (req.user && req.user._id) {
        User.findOne({
                _id: req.user._id
            })
            .exec(function(err, user) {
                if (user.avatar !== undefined) {
                    res.redirect('/#!/');
                } else {
                    res.redirect('/#!/choose-avatar');
                }
            });
    } else {
        // If user doesn't even exist, redirect to /
        res.redirect('/');
    }

};

exports.register = function (req, res) {
  if (req.body.name && req.body.password && req.body.email) {
    User.findOne({
      email: req.body.email
    }).exec(function(err, existingUser) {
      if (!existingUser) {
        var user = new User(req.body);
        // Switch the user's avatar index to an actual avatar url
        user.avatar = avatars[user.avatar];
        user.provider = 'local';
        user.save(function (err) {
          if (err) {
            return res.send({
              msg: err.errors
            });
          }
          var userInfo = {
            email: req.body.email
          };
          res.status(200).json({
            token: generateToken(userInfo),
            user: userInfo
          });
        });
      } else {
        return res.send({
          message: 'Email exists'
        });
      }
    });
  } else {
    return res.send({
      message: 'You have not filled some fields'
    });
  }
};

/**
 * Create user
 */
exports.create = function(req, res) {
    if (req.body.name && req.body.password && req.body.email) {
        User.findOne({
            email: req.body.email
        }).exec(function(err, existingUser) {
            if (!existingUser) {
                var user = new User(req.body);
                // Switch the user's avatar index to an actual avatar url
                user.avatar = avatars[user.avatar];
                user.provider = 'local';
                user.save(function(err) {
                    if (err) {
                        return res.render('/#!/signup?error=unknown', {
                            errors: err.errors,
                            user: user
                        });
                    }
                    req.logIn(user, function(err) {
                        if (err) return next(err);
                        return res.redirect('/#!/');
                    });
                });
            } else {
                return res.redirect('/#!/signup?error=existinguser');
            }
        });
    } else {
        return res.redirect('/#!/signup?error=incomplete');
    }
};

/**
 * Assign avatar to user
 */
exports.avatars = function(req, res) {
    // Update the current user's profile to include the avatar choice they've made
    if (req.user && req.user._id && req.body.avatar !== undefined &&
        /\d/.test(req.body.avatar) && avatars[req.body.avatar]) {
        User.findOne({
                _id: req.user._id
            })
            .exec(function(err, user) {
                user.avatar = avatars[req.body.avatar];
                user.save();
            });
    }
    return res.redirect('/#!/app');
};

exports.addDonation = function(req, res) {
    if (req.body && req.user && req.user._id) {
        // Verify that the object contains crowdrise data
        if (req.body.amount && req.body.crowdrise_donation_id && req.body.donor_name) {
            User.findOne({
                    _id: req.user._id
                })
                .exec(function(err, user) {
                    // Confirm that this object hasn't already been entered
                    var duplicate = false;
                    for (var i = 0; i < user.donations.length; i++) {
                        if (user.donations[i].crowdrise_donation_id === req.body.crowdrise_donation_id) {
                            duplicate = true;
                        }
                    }
                    if (!duplicate) {
                        console.log('Validated donation');
                        user.donations.push(req.body);
                        user.premium = 1;
                        user.save();
                    }
                });
        }
    }
    res.send();
};

/**
 *  Show profile
 */
exports.show = function(req, res) {
    var user = req.profile;

    res.render('users/show', {
        title: user.name,
        user: user
    });
};

/**
 * Send User
 */
exports.me = function(req, res) {
    res.jsonp(req.user || null);
};

/**
 * Find user by id
 */
exports.user = function(req, res, next, id) {
    User
        .findOne({
            _id: id
        })
        .exec(function(err, user) {
            if (err) return next(err);
            if (!user) return next(new Error('Failed to load User ' + id));
            req.profile = user;
            next();
        });
};

exports.authToken = function(req, res, next) {

    // check header or url parameters or post parameters for token
    var token = req.body.token || req.query.token || req.headers['x-access-token'];

    // decode token
    if (token) {
        // verifies secret and checks exp
        jwt.verify(token, config.secret, function(err, decoded) {
            if (err) {
                return res.json({ success: false, message: 'Failed to authenticate token.' });
            } else {
                // if everything is good, save to request for use in other routes
                req.decoded = decoded;
                next();
            }
        });

    } else {

        // if there is no token
        // return an error
        return res.status(403).send({
            success: false,
            message: 'No token provided.'
        });

    }
};

/**
 * Search current users by username
 */ 
exports.searchUsers = function(req, res) {
  User
    .find({
    name: new RegExp(req.query.name, 'i')
  })
    // removes field hashed_password from results
    .select('-hashed_password')
    .exec(function(err, users) {
    if (err) return next(err);
    if (users.length === 0) {
        res.send('User Not Found');
    } else {
        res.send(users);
    }
  });
};
