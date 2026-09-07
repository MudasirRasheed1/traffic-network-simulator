package com.ilgc.simulator.backend.repository;

import com.ilgc.simulator.backend.model.SimulationRun;
import com.ilgc.simulator.backend.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SimulationRunRepository extends JpaRepository<SimulationRun, Long> {
    List<SimulationRun> findByUserOrderByCreatedAtDesc(User user);
}
