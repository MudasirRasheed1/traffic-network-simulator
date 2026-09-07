package com.ilgc.simulator.backend.controller;

import com.ilgc.simulator.backend.model.SimulationRun;
import com.ilgc.simulator.backend.model.User;
import com.ilgc.simulator.backend.service.SimulationService;
import com.ilgc.simulator.backend.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/simulations")
public class SimulationController {

    @Autowired
    private SimulationService simulationService;

    @Autowired
    private UserService userService;

    @PostMapping("/save")
    public ResponseEntity<?> saveSimulation(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @RequestBody SaveRequest request) {
        
        Optional<User> userOpt = verifyUser(authHeader);
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("message", "Unauthorized"));
        }

        if (request.getName() == null || request.getName().trim().isEmpty() ||
            request.getConfigJson() == null || request.getConfigJson().isEmpty() ||
            request.getResultsJson() == null || request.getResultsJson().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Name, Config parameters and Results are required"));
        }

        User user = userOpt.get();
        SimulationRun run = simulationService.saveSimulationRun(
                user,
                request.getName().trim(),
                request.getDescription() != null ? request.getDescription().trim() : "",
                request.getConfigJson(),
                request.getResultsJson()
        );

        return ResponseEntity.ok(mapRunToResponse(run));
    }

    @GetMapping("/list")
    public ResponseEntity<?> listSimulations(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        
        Optional<User> userOpt = verifyUser(authHeader);
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("message", "Unauthorized"));
        }

        User user = userOpt.get();
        List<SimulationRun> runs = simulationService.getSimulationRunsForUser(user);
        
        List<Map<String, Object>> response = new ArrayList<>();
        for (SimulationRun run : runs) {
            response.add(mapRunToResponse(run));
        }

        return ResponseEntity.ok(response);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteSimulation(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @PathVariable Long id) {
        
        Optional<User> userOpt = verifyUser(authHeader);
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("message", "Unauthorized"));
        }

        User user = userOpt.get();
        boolean deleted = simulationService.deleteSimulationRun(id, user);

        if (deleted) {
            return ResponseEntity.ok(Map.of("message", "Simulation deleted successfully"));
        } else {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("message", "Simulation not found or access denied"));
        }
    }

    private Optional<User> verifyUser(String authHeader) {
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);
            return userService.getUserFromToken(token);
        }
        return Optional.empty();
    }

    private Map<String, Object> mapRunToResponse(SimulationRun run) {
        Map<String, Object> map = new HashMap<>();
        map.put("id", run.getId());
        map.put("name", run.getName());
        map.put("description", run.getDescription());
        map.put("configJson", run.getConfigJson());
        map.put("resultsJson", run.getResultsJson());
        map.put("createdAt", run.getCreatedAt().toString());
        return map;
    }

    // Static request DTO
    public static class SaveRequest {
        private String name;
        private String description;
        private String configJson;
        private String resultsJson;

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public String getDescription() {
            return description;
        }

        public void setDescription(String description) {
            this.description = description;
        }

        public String getConfigJson() {
            return configJson;
        }

        public void setConfigJson(String configJson) {
            this.configJson = configJson;
        }

        public String getResultsJson() {
            return resultsJson;
        }

        public void setResultsJson(String resultsJson) {
            this.resultsJson = resultsJson;
        }
    }
}
