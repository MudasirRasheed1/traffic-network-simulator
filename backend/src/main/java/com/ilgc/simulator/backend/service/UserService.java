package com.ilgc.simulator.backend.service;

import com.ilgc.simulator.backend.model.User;
import com.ilgc.simulator.backend.model.UserSession;
import com.ilgc.simulator.backend.repository.UserRepository;
import com.ilgc.simulator.backend.repository.UserSessionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

@Service
public class UserService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private UserSessionRepository userSessionRepository;

    private final SecureRandom secureRandom = new SecureRandom();

    @Transactional
    public User registerUser(String username, String email, String password) throws IllegalArgumentException {
        if (userRepository.existsByUsername(username)) {
            throw new IllegalArgumentException("Username already exists");
        }
        if (userRepository.existsByEmail(email)) {
            throw new IllegalArgumentException("Email already exists");
        }

        byte[] saltBytes = new byte[16];
        secureRandom.nextBytes(saltBytes);
        String salt = Base64.getEncoder().encodeToString(saltBytes);

        String passwordHash = hashPassword(password, salt);

        User user = new User(username, email, passwordHash, salt);
        return userRepository.save(user);
    }

    @Transactional
    public Optional<UserSession> loginUser(String usernameOrEmail, String password) {
        Optional<User> userOpt = userRepository.findByUsername(usernameOrEmail);
        if (userOpt.isEmpty()) {
            userOpt = userRepository.findByEmail(usernameOrEmail);
        }

        if (userOpt.isEmpty()) {
            return Optional.empty();
        }

        User user = userOpt.get();
        String hash = hashPassword(password, user.getSalt());

        if (user.getPasswordHash().equals(hash)) {
            // Generate session token
            String token = UUID.randomUUID().toString();
            // Session expires in 7 days
            LocalDateTime expiresAt = LocalDateTime.now().plusDays(7);
            UserSession session = new UserSession(token, user.getId(), expiresAt);
            userSessionRepository.save(session);
            return Optional.of(session);
        }

        return Optional.empty();
    }

    @Transactional
    public void logoutUser(String token) {
        userSessionRepository.deleteById(token);
    }

    public Optional<User> getUserFromToken(String token) {
        Optional<UserSession> sessionOpt = userSessionRepository.findById(token);
        if (sessionOpt.isEmpty() || sessionOpt.get().isExpired()) {
            if (sessionOpt.isPresent()) {
                userSessionRepository.delete(sessionOpt.get());
            }
            return Optional.empty();
        }
        return userRepository.findById(sessionOpt.get().getUserId());
    }

    private String hashPassword(String password, String salt) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String input = password + salt;
            byte[] encodedhash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            
            StringBuilder hexString = new StringBuilder(2 * encodedhash.length);
            for (byte b : encodedhash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 algorithm not found", e);
        }
    }
}
