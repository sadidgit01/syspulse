package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/sadidgit01/syspulse/apps/agent/go_agent/collector"
	"github.com/sadidgit01/syspulse/apps/agent/go_agent/config"
	"github.com/sadidgit01/syspulse/apps/agent/go_agent/shipper"
	"google.golang.org/grpc"
)

func main() {
	fmt.Print(banner())

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Configuration error: %v\n", err)
		os.Exit(1)
	}

	agentCollector, err := collector.New()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Collector error: %v\n", err)
		os.Exit(1)
	}

	_ = grpc.SupportPackageIsVersion9

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	metricCh := make(chan collector.MetricSnapshot, cfg.BatchSize*2)
	logCh := make(chan []collector.LogEntry, 4)
	certDir := cfg.CertDir
	if err := shipper.DownloadCerts(cfg.Server, cfg.AgentToken, certDir); err != nil {
		fmt.Printf("Certificate bootstrap skipped: %v\n", err)
	}
	agentShipper := shipper.NewWithCertDir(cfg.Server, cfg.AgentToken, certDir)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		runCollector(ctx, agentCollector, cfg.Interval, metricCh, logCh)
	}()
	go func() {
		defer wg.Done()
		runShipper(ctx, agentShipper, cfg.BatchSize, metricCh, logCh)
	}()

	<-ctx.Done()
	fmt.Println("Shutdown signal received, flushing pending telemetry...")
	wg.Wait()
	fmt.Println("SysPulse agent stopped cleanly")
}

func runCollector(
	ctx context.Context,
	agentCollector *collector.Collector,
	interval time.Duration,
	metricCh chan<- collector.MetricSnapshot,
	logCh chan<- []collector.LogEntry,
) {
	defer close(metricCh)
	defer close(logCh)

	metricTicker := time.NewTicker(interval)
	defer metricTicker.Stop()
	logTicker := time.NewTicker(60 * time.Second)
	defer logTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-metricTicker.C:
			snapshot, err := agentCollector.CollectMetric(ctx)
			if err != nil {
				fmt.Printf("Metric collection failed: %v\n", err)
				continue
			}
			select {
			case metricCh <- snapshot:
			case <-ctx.Done():
				return
			}
		case <-logTicker.C:
			logs, err := agentCollector.CollectLogs(ctx)
			if err != nil {
				fmt.Printf("Log collection failed: %v\n", err)
				continue
			}
			if len(logs) == 0 {
				continue
			}
			select {
			case logCh <- logs:
			case <-ctx.Done():
				return
			}
		}
	}
}

func runShipper(
	ctx context.Context,
	agentShipper *shipper.Shipper,
	batchSize int,
	metricCh <-chan collector.MetricSnapshot,
	logCh <-chan []collector.LogEntry,
) {
	metricsBatch := make([]collector.MetricSnapshot, 0, batchSize)

	flushMetrics := func() {
		if len(metricsBatch) == 0 {
			return
		}
		if err := agentShipper.ShipMetrics(context.Background(), metricsBatch); err != nil {
			fmt.Printf("Final metric ship failed: %v\n", err)
		}
		metricsBatch = metricsBatch[:0]
	}

	for metricCh != nil || logCh != nil {
		select {
		case snapshot, ok := <-metricCh:
			if !ok {
				metricCh = nil
				flushMetrics()
				continue
			}
			metricsBatch = append(metricsBatch, snapshot)
			if len(metricsBatch) >= batchSize {
				if err := agentShipper.ShipMetrics(ctx, metricsBatch); err != nil {
					fmt.Printf("Metric batch failed: %v\n", err)
				}
				metricsBatch = metricsBatch[:0]
			}
		case logs, ok := <-logCh:
			if !ok {
				logCh = nil
				continue
			}
			if err := agentShipper.ShipLogs(ctx, logs); err != nil {
				fmt.Printf("Log batch failed: %v\n", err)
			}
		case <-ctx.Done():
			for metricCh != nil || logCh != nil {
				select {
				case snapshot, ok := <-metricCh:
					if !ok {
						metricCh = nil
						continue
					}
					metricsBatch = append(metricsBatch, snapshot)
				case logs, ok := <-logCh:
					if !ok {
						logCh = nil
						continue
					}
					if err := agentShipper.ShipLogs(context.Background(), logs); err != nil {
						fmt.Printf("Final log ship failed: %v\n", err)
					}
				default:
					flushMetrics()
					return
				}
			}
			flushMetrics()
			return
		}
	}
	flushMetrics()
}

func banner() string {
	return `
  ____            ____        __
 / ___| _   _ ___|  _ \ _   _| |___  ___
 \___ \| | | / __| |_) | | | | / __|/ _ \
  ___) | |_| \__ \  __/| |_| | \__ \  __/
 |____/ \__, |___/_|    \__,_|_|___/\___|
        |___/
 Production Go Agent

`
}
