<<<<<<< HEAD
# OFAT Analysis Details

Generated At: 2026-04-23T05:08:39.001Z
Output Root: C:\Users\mudas\OneDrive\Documents\Desktop\Plaksha\Plaksha-Sem-6\ILGC\ILGC\simulator\analysis\ofat_sensitivity
=======
>>>>>>> ecc3104da0d3c0cc6466aaf40ba53da4c1362aa2

## Run Plan

- Regimes: arrivals_gt_departures
- Seeds Per Point: 1
- Plot Minimum Simulations (global floor): 20
- Total Simulation Runs: 251

## Boundary Model

- Grid Size: 5
- Boundary Nodes: 16
- Corner Boundary Nodes: 4
- Edge Boundary Nodes: 12
- Boundary Streams (Pipes): 20

Formulas:
- arrivalsPerStep = boundaryStreamCount * ((arrivalMin + arrivalMax) / 2)
- departuresPerStep = boundaryStreamCount * baseDepartureRate
- Compare arrivalsPerStep vs departuresPerStep for lt/eq/gt

## Fixed Regime Conditions

### arrivals_gt_departures
- arrivalMin: 0
- arrivalMax: 40
- departureRatePerBoundaryPipe: 8
- arrivalsPerStep: 400
- departuresPerStep: 160
- classificationCheck: arrivals_gt_departures
- classificationMatchesTarget: true

## Nominal Factor Point Plan

- arrivalUniformMax: points=20, range=[0, 40]
- throughTurnProb: points=20, range=[0, 1]
- leftTurnProb: points=20, range=[0, 1]
- rightTurnProb: points=20, range=[0, 1]
- defaultRoadSpeed: points=20, range=[1, 20]
- defaultRoadLength: points=30, range=[2, 100]
- fixedCycleInterval: points=20, range=[1, 30]
- greedyDecisionInterval: points=20, range=[1, 30]
- lookaheadH: points=20, range=[1, 20]
- totalWaitWeight: points=20, range=[0, 20]
- totalWaitStdWeight: points=20, range=[0, 20]
- queueWeight: points=20, range=[0, 20]
- queueStdWeight: points=20, range=[0, 20]

## Effective Factor Plan By Regime

### arrivals_gt_departures
- arrivalUniformMax: effectivePoints=1, effectiveRange=[40, 40], simCount=1, requiredSimsToPlot=1, plotEnabled=false, plotEligible=false
- throughTurnProb: effectivePoints=20, effectiveRange=[0, 1], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true
- leftTurnProb: effectivePoints=20, effectiveRange=[0, 1], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true
- rightTurnProb: effectivePoints=20, effectiveRange=[0, 1], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true
- defaultRoadSpeed: effectivePoints=20, effectiveRange=[1, 20], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true
- defaultRoadLength: effectivePoints=30, effectiveRange=[2, 100], simCount=30, requiredSimsToPlot=30, plotEnabled=true, plotEligible=true
- fixedCycleInterval: effectivePoints=20, effectiveRange=[1, 30], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true
- greedyDecisionInterval: effectivePoints=20, effectiveRange=[1, 30], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true
- lookaheadH: effectivePoints=20, effectiveRange=[1, 20], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true
- totalWaitWeight: effectivePoints=20, effectiveRange=[0, 20], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true
- totalWaitStdWeight: effectivePoints=20, effectiveRange=[0, 20], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true
- queueWeight: effectivePoints=20, effectiveRange=[0, 20], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true
- queueStdWeight: effectivePoints=20, effectiveRange=[0, 20], simCount=20, requiredSimsToPlot=20, plotEnabled=true, plotEligible=true


## Seed Policy

- baseSeed: 2
- runSeed = baseSeed + seedRep
- inflowSeedOffset = seedRep * 101

## Runtime Output Behavior

- Script logs every simulation completion with progress and ETA.
- Partial CSVs and plots are written as factors complete.
<<<<<<< HEAD
- Plots are created under analysis/ofat_sensitivity/plots/very_high_arrivals_one_seed/<regime>.
=======
- Plots are created under analysis/ofat_sensitivity/plots/<regime>.
>>>>>>> ecc3104da0d3c0cc6466aaf40ba53da4c1362aa2
