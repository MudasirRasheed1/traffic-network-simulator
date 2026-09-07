package com.ilgc.simulator.backend.config;

import com.ilgc.simulator.backend.model.User;
import com.ilgc.simulator.backend.repository.UserRepository;
import com.ilgc.simulator.backend.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Optional;

@Component
public class DatabaseSeeder implements CommandLineRunner {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private UserService userService;

    @Override
    public void run(String... args) throws Exception {
        try {
            Optional<User> rootOpt = userRepository.findByUsername("root");
            if (rootOpt.isPresent()) {
                // Ensure password is reset to "root"
                User rootUser = rootOpt.get();
                byte[] saltBytes = new byte[16];
                new SecureRandom().nextBytes(saltBytes);
                String salt = Base64.getEncoder().encodeToString(saltBytes);
                
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                String input = "root" + salt;
                byte[] encodedhash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
                StringBuilder hexString = new StringBuilder(2 * encodedhash.length);
                for (byte b : encodedhash) {
                    String hex = Integer.toHexString(0xff & b);
                    if (hex.length() == 1) hexString.append('0');
                    hexString.append(hex);
                }
                
                rootUser.setSalt(salt);
                rootUser.setPasswordHash(hexString.toString());
                userRepository.save(rootUser);
                System.out.println("========== DATABASE SEEDED: Root user password updated to 'root' ==========");
                System.out.println("Username: root");
                System.out.println("Password: root");
                System.out.println("=====================================================================");
            } else {
                userService.registerUser("root", "root@traffic.ilgc", "root");
                System.out.println("========== DATABASE SEEDED: Root user created successfully ==========");
                System.out.println("Username: root");
                System.out.println("Password: root");
                System.out.println("=====================================================================");
            }
        } catch (Exception e) {
            System.err.println("Failed to seed root user: " + e.getMessage());
        }
    }
}
