package com.ilgc.simulator.backend.service;

import com.ilgc.simulator.backend.model.SimulationRun;
import com.ilgc.simulator.backend.model.User;
import com.ilgc.simulator.backend.repository.SimulationRunRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
public class SimulationService {

    @Autowired
    private SimulationRunRepository simulationRunRepository;

    @Transactional
    public SimulationRun saveSimulationRun(User user, String name, String description, String configJson, String resultsJson) {
        SimulationRun run = new SimulationRun(user, name, description, configJson, resultsJson);
        return simulationRunRepository.save(run);
    }

    public List<SimulationRun> getSimulationRunsForUser(User user) {
        return simulationRunRepository.findByUserOrderByCreatedAtDesc(user);
    }

    public Optional<SimulationRun> getSimulationRunById(Long id) {
        return simulationRunRepository.findById(id);
    }

    @Transactional
    public boolean deleteSimulationRun(Long id, User user) {
        Optional<SimulationRun> runOpt = simulationRunRepository.findById(id);
        if (runOpt.isPresent() && runOpt.get().getUser().getId().equals(user.getId())) {
            simulationRunRepository.delete(runOpt.get());
            return true;
        }
        return false;
    }
}
