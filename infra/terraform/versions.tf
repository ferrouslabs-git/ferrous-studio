terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }

  # Remote state, shared across every operator's machine: local state (the
  # previous default here) meant only the machine that first ran `apply`
  # ever had a copy, and if that machine's disk is gone, so is the only
  # record of what Terraform manages -- exactly what happened before this
  # was added (see docs/go-live-and-merge-boards.md phase 1's Terraform
  # section). The DynamoDB table serialises concurrent applies from
  # different machines so two operators can't corrupt state by racing.
  #
  # `terraform init` picks this up automatically; on an existing local
  # state it offers to migrate ("Do you want to copy existing state to the
  # new backend?") -- say yes once, from whichever machine holds the real
  # state (or accept an empty remote state only if none exists anywhere,
  # then rebuild it via `terraform import` against what is actually
  # deployed before ever running `apply`).
  backend "s3" {
    bucket         = "ferrous-studio-terraform-state"
    key            = "ferrous-studio/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "ferrous-studio-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = local.region
  # Uses the AWS default profile / credential chain -- no profile pinned here.
}
